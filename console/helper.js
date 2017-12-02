
/**
 *  Helpers for routing a request within the cluster.
 *
 *  When a request arrives at the webtier, it will get routed by one of two mechanisms.
 *  The first is the standard SA way, with entries in the DB for apps, projects and all
 *  that. This file is concerned with the other way. It is for use by modules that are
 *  not customer-facing, and are 'inernal' to the SA system, and the SA instance. Things
 *  like the xapi module, including the retrieval of telemetry data.
 *
 *  Essentially, when a request arrives it has 4 initial path components. This module
 *  helps map between those route-parts, and the beacon that modules put into Redis.
 *  As well as helping actually do the routing.
 *
 *  Things of note:
 *
 *  * How to rewrite the path.
 *  * Building the handler.
 *  * Building most routes.
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const urlLib                  = require('url');

const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const isClientCertOk          = serverassist.isClientCertOk;
const mkServiceFinder2        = serverassist.mkServiceFinder2;
const mkStackServiceFinder2   = serverassist.mkServiceFinder2ForStack;

var lib = {};

/**
 *  Sets various things, based on the cluster configuration.
 *
 *  Internal modules should call serverassist.configuration() regularly, and if the resulting
 *  configuration has changed, call this function. It understands things like the running
 *  state of the system, and how that figures into routing. For example, which color is 'main'
 *  in which stack.
 *
 */
const reconfigure = lib.reconfigure = function(modName, r_, projects, projectRunningStates) {

  console.log(`${modName} reconfiguring`);

  var   projectByDomainName_, appBySubdomain_, xapiPrefixes_, app_prjs_, knownProjectIds_ = {};

  const r = r_;

  // Remember the 'sa' project (so we can associate it with mobilewebassist.net)
  var   saProject;

  // Which projects (by db record) are associated with which domain names?
  projectByDomainName_ = sg.reduce(r.db.projectRecords, {}, (m, project) => {
    if (project.projectId === 'sa')   { saProject = project; }
    if (project.uriBase)              { m = sg.kv(m, project.uriBase.split('/')[0], project); }
    if (project.uriTestBase)          { m = sg.kv(m, project.uriTestBase.split('/')[0], project); }

    knownProjectIds_ = sg.kv(knownProjectIds_, project.projectId, {});

    projects[project.projectId] = project;
    return m;
  });
  projectByDomainName_['mobilewebassist.net'] = saProject;
  projectByDomainName_['mobiledevassist.net'] = saProject;

  // Which apps (by db record) are associated with what subdomains?
  appBySubdomain_ = sg.reduce(r.db.appRecords, {}, (m, app) => {
    if (app.subdomain) { return sg.kv(m, app.subdomain.split('.')[0], app); }
    return m;
  });

  // Get the prefixes for xapi (like telemetry, attrstream, s3)
  xapiPrefixes_ = sg.reduce(r.db.appRecords, [], (m, app) => {
    return sg.ap(m, deref(app, ['xapiPrefix']));
  });

  app_prjs_ = sg.reduce(r.db.appprjRecords, {}, (m, appprj) => {
    knownProjectIds_ = sg.kv(knownProjectIds_, appprj.projectId, appprj);

    return sg.kv(m, appprj.appProjectId, appprj);
  });

  // ------------------------------------------------------------------------
  //  Find the running state for each stack type. I.e. "In the test stack,
  //  which instances/colors are main, next, etc?
  //
  //   ntl:
  //    { pub:
  //       { prev:
  //          { projectServicePrefix: 'netlab',
  //            color: 'green',
  //            projectId: 'ntl',
  //            stack: 'pub',
  //            state: 'prev',
  //            fqdn: 'green-pub.mobilewebassist.net',
  //            account: 'pub',
  //            baseProjectServicePrefix: 'serverassist' },
  //         main:
  //          { projectServicePrefix: 'netlab',
  //            color: 'blue',
  //            projectId: 'ntl',
  //            stack: 'pub',
  //            state: 'main',
  //            fqdn: 'blue-pub.mobilewebassist.net',
  //            account: 'pub',
  //            baseProjectServicePrefix: 'serverassist' } },
  //      cluster:
  //       { main: }}
  //

  // Find the state of the instances (which colors are main, for example)
  _.each(r.db.instanceRecords, (instance) => {
    const project = r.db.projectRecords[instance.projectId] || {};

    if (instance.state in {main:true, next:true, prev:true}) {                            /* other states like 'gone' are meaningless here */
      const projectServicePrefix  = project.serviceName || project.projectName || 'psn';
      const runningState          = sg._extend({projectServicePrefix}, instance);

      setOnn(projectRunningStates, [instance.projectId, instance.stack, instance.state], runningState);
    }
  });

  // Some projects have 'sa' as a base project; setup their running state
  _.each(r.db.projectRecords, (project) => {
    if (!project.base || !projectRunningStates[project.base]) { return; }

    // Only set it if we do not alreay have it
    if (!projectRunningStates[project.projectId]) {
      const projectServicePrefix  = project.serviceName || project.commonName || project.projectName || 'psn';

      setOnn(projectRunningStates, project.projectId, sg.deepCopy(deref(projectRunningStates, project.base)));

      // Fixup entries
      _.each(deref(projectRunningStates, project.projectId), (runningStack, runningStackName) => {
        _.each(runningStack, (runningState, runningStateName) => {
          const baseProjectServicePrefix = deref(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectServicePrefix']);

          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'baseProjectServicePrefix'],   baseProjectServicePrefix);
          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectServicePrefix'],       projectServicePrefix);
          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectId'],                  project.projectId);
        });
      });
    }
  });
  //console.log('-------------------------------', util.inspect(projectRunningStates, {depth:null, colors:true}));

  // Some app_prjs have 'sa' as a base project; setup their running state
  _.each(r.db.appprjRecords, (appprj) => {

    // Only set it if we do not alreay have it
    if (projectRunningStates[appprj.projectId]) { return; }

    const projectServicePrefix  = appprj.serviceNamespace;

    setOnn(projectRunningStates, appprj.projectId, sg.deepCopy(deref(projectRunningStates, 'sa')));

    // Fixup entries
    _.each(deref(projectRunningStates, appprj.projectId), (runningStack, runningStackName) => {
      _.each(runningStack, (runningState, runningStateName) => {
        const baseProjectServicePrefix = deref(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectServicePrefix']);

        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'baseProjectServicePrefix'],   baseProjectServicePrefix);
        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectServicePrefix'],       projectServicePrefix);
        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectId'],                  appprj.projectId);
      });
    });
  });
  //console.log('-------------------------------', util.inspect(projectRunningStates, {depth:null, colors:true}));

  // Update the global vars all at once
  const knownProjectIds     = knownProjectIds_;
  const projectByDomainName = projectByDomainName_;
  const appBySubdomain      = appBySubdomain_;
  const xapiPrefixes        = xapiPrefixes_;
  const app_prjs            = app_prjs_;
  const serviceFinders      = {};

  return {
    knownProjectIds,
    projectByDomainName,
    appBySubdomain,
    xapiPrefixes,
    app_prjs,
    serviceFinders
  };
};

/**
 *  Caches serviceFinder2s
 */
lib.ServiceFinderCache = function() {
  var self = this;

  var serviceFinders        = {};
  var r                     = {};
  var projectRunningStates  = {};

  self.reset = self.flush = function(r_, projectRunningStates_) {
    serviceFinders          = {};
    r                       = r_;
    projectRunningStates    = projectRunningStates_;
  };

  self.getServiceFinder = function(projectId, projectServicePrefix, requestedStack, requestedState) {
    const index         = [projectServicePrefix, requestedStack, requestedState];
    var   serviceFinder;

    if (!(serviceFinder = deref(serviceFinders, index))) {
      serviceFinder = mkServiceFinder2(projectId, projectServicePrefix, requestedStack, requestedState, r, projectRunningStates);
      setOnn(serviceFinders, index, serviceFinder);
    }

    return serviceFinder;
  };

  self.getStackServiceFinder = function(projectServicePrefix, requestedStack) {
    const index         = [projectServicePrefix, requestedStack];
    var   serviceFinder;

    if (!(serviceFinder = deref(serviceFinders, index))) {
      serviceFinder = mkStackServiceFinder2(projectServicePrefix, requestedStack);
      setOnn(serviceFinders, index, serviceFinder);
    }

    return serviceFinder;
  };

};

/**
 *  Makes handlers
 */
lib.mkHandler = function(r, usersDb, serviceFinderCache, projectRunningStates, knownProjectIds, app_prj, app_prjName, options__) {
  const options_                  = options__ || {};
  const serviceFinderStack        = options_.serviceFinderStack;
  const defServiceName            = options_.defServiceName;
  const defPrefix                 = options_.defPrefix;

  const projectId                 = deref(app_prj, 'project.projectId');
  var   projectServicePrefix      = deref(app_prj, 'project.serviceName') || deref(app_prj, 'project.projectName');

  return (function(req, res, params, splats, query_, match, options, callback) {
    return isClientCertOk(req, res, usersDb, (err, isOk, user) => {

      const url             = urlLib.parse(req.url, true);

      return sg.__run2({}, [function(result, next, last) {
        if (err)                                    { console.error(err); return serverassist._403(req, res); }
        if (!isOk)                                  { return serverassist._403(req, res); }

        // Let caller see the client-cert info
        if (!options.checkClientCert)               { return next(); }

        return options.checkClientCert(isOk, user, next);

      }, function(result, next, last) {

        // Figure out the parameters for the request (as opposed to what was
        // setup when calling mkHandler)
        const reqProjectId            = params.projectId || projectId;
        const reqApp_prjName          = app_prjName.replace(projectId, reqProjectId);
        const reqProjectServicePrefix = (knownProjectIds[reqProjectId] || {}).serviceNamespace ||
                                        deref(r.db, ['projectRecords', reqProjectId, 'serviceName']) ||
                                        deref(r.db, ['projectRecords', projectId, 'serviceName']) ||
                                        projectServicePrefix;

        const all           = sg._extend(params || {}, query_ || {});
        const query         = _.omit(query_, 'rsvr');

        // The id of the service (like mxp_xapi_s3_1) -- (aname === s3, in this case)
        const serviceId     = _.compact([reqApp_prjName, params.aname, params.version]).join('_');
        var serviceIdMsg    = serviceId;

        // Which stack?
        const [ requestedStack, requestedState ] = serverassist.decodeRsvr(all.rsvr);

        const runningState  = deref(projectRunningStates, [reqProjectId, requestedStack, requestedState]);

        return next();

      }, function(result, next, last) {

        // Is the request for the default service?

        if (!defServiceName || serviceId !== defServiceName)       { return next(); }

        const serviceFinder = serviceFinderCache.getStackServiceFinder('serverassist', 'cluster');

        return serviceFinder.getOneServiceLocation(defServiceName, (err, location) => {
          if (sg.ok(err, location)) {

            result.rewrite = url.href;
            if (defPrefix && url.href.startsWith(defPrefix)) {
              result.rewrite = result.rewrite.substring(defPrefix.length);
            }

            return last(null, result);
          }

          return next();
        });

      }, function(result, next, last) {
        if (!serviceFinderStack)          { return next(); }

        const serviceFinder = serviceFinderCache.getStackServiceFinder(reqProjectServicePrefix, serviceFinderStack);

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = reqProjectServicePrefix+':'+serviceId;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (!serviceFinderStack)          { return next(); }

        const myPrefix      = deref(r.db, 'projectRecords.sa.serviceName');
        const serviceFinder = serviceFinderCache.getStackServiceFinder(myPrefix, serviceFinderStack);

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = myPrefix+':'+serviceId;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (!serviceFinderStack)          { return next(); }

        const myPrefix      = deref(r.db, 'projectRecords.sa.serviceName');
        const serviceFinder = serviceFinderCache.getStackServiceFinder(myPrefix, serviceFinderStack);

        return serviceFinder.getOneServiceLocation('serverassist', (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = myPrefix+':'+'serverassist';
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (serviceFinderStack)          { return next(); }

        // -----------------------------------------------------------------------------------------------
        // Get the more-specific service
        //
        // Assuming green matches main or next from requestedState
        //
        //    mobilewebprint-green-test:mwp_xapi_telemetry_1
        //            netlab-green-test:ntl_xapi_telemetry_1

        const serviceFinder = serviceFinderCache.getServiceFinder(reqProjectId, reqProjectServicePrefix, requestedStack, requestedState);

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = reqProjectServicePrefix+':'+serviceIdMsg;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (serviceFinderStack)          { return next(); }

        // -----------------------------------------------------------------------------------------------
        // If we have not found the service, fall back (next --> main)
        //
        // Assuming blue is main, req is for next, and green is next
        //
        //    mobilewebprint-blue-test:mwp_xapi_telemetry_1
        //            netlab-blue-test:ntl_xapi_telemetry_1

        if (requestedState !== 'next')  { return next(); }

        const serviceFinder = serviceFinderCache.getServiceFinder(reqProjectId, reqProjectServicePrefix, requestedStack, 'main');

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = reqProjectServicePrefix+':'+serviceIdMsg;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (serviceFinderStack)          { return next(); }

        // -----------------------------------------------------------------------------------------------
        // If we cannot find the service from the more-specific id, just use the base version
        //
        // Assuming green matches main or next from requestedState
        //
        //    serverassist-green-test:mwp_xapi_telemetry_1
        //    serverassist-green-test:ntl_xapi_telemetry_1

        if (!runningState.baseProjectServicePrefix) { return next(); }

        const serviceFinder = serviceFinderCache.getServiceFinder(reqProjectId, runningState.baseProjectServicePrefix, requestedStack, requestedState);

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = runningState.baseProjectServicePrefix+':'+serviceIdMsg;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }, function(result, next, last) {
        if (serviceFinderStack)          { return next(); }

        // -----------------------------------------------------------------------------------------------
        // If we still have not found the service, fall back (next --> main), using base version
        //
        // Assuming blue is main, req is for next, and green is next
        //
        //    serverassist-blue-test:mwp_xapi_telemetry_1
        //    serverassist-blue-test:ntl_xapi_telemetry_1

        if (requestedState !== 'next')                { return next(); }
        if (!runningState.baseProjectServicePrefix)   { return next(); }

        const serviceFinder = serviceFinderCache.getServiceFinder(reqProjectId, runningState.baseProjectServicePrefix, requestedStack, 'main');

        return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
          if (sg.ok(err, location)) {
            serviceIdMsg    = runningState.baseProjectServicePrefix+':'+serviceIdMsg;
            result.location = location;

            return last(null, result);
          }
          return next();
        });

      }], function last(err, result) {

        // Now, translate the route (rewrite phase)
        return sg.__run2(result, [function(result, next, last) {
          return next();
        }], function lastRewrite(err, result) {

          // -----------------------------------------------------------------------------------------------
          // Send the result

          return callback(err, serviceIdMsg, result.location, {query});
        });
      });

    });
  });
};










_.each(lib, function(value, key) {
  exports[key] = value;
});


