
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const urlLib                  = require('url');
const qsLib                   = require('querystring');
const serverassist            = sg.include('serverassist') || require('serverassist');

const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const isClientCertOk          = serverassist.isClientCertOk;
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const registerAsService       = serverassist.registerAsService;
const redirectToService       = serverassist.redirectToService;
const mkServiceFinder2        = serverassist.mkServiceFinder2;

const appId                   = 'sa_xapi';
const mount                   = '*/xapi/v1/';
const projectId               = 'sa';

const appRecord = {
  projectId,
  mount,
  appId,
  route               : '*/xapi/v:version/',
  isAdminApp          : true,
  useHttp             : false,
  useHttps            : true,
  requireClientCerts  : true,
  subdomain           : 'console.'
};

const xapiPrefixesX    = 's3,telemetry,attrstream'.split(',').map(x => `:tname(${x})`);

var   lib             = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {
  var   r;

  var   projectByDomainName, appBySubdomain, xapiPrefixes, app_prjs;

  var   projectRunningStates = {};

  var   projects       = {};
  const usersDb        = db.collection('users');

  // Remember the handlers by projectId
  var   handlers = {};

  var   serviceFinders   = {};
  const getServiceFinder = function(projectId, projectServicePrefix, requestedStack, requestedState) {
    const index         = [projectServicePrefix, requestedStack, requestedState];
    var   serviceFinder;

    if (!(serviceFinder = deref(serviceFinders, index))) {
      serviceFinder = mkServiceFinder2(projectId, projectServicePrefix, requestedStack, requestedState, r, projectRunningStates);
      setOnn(serviceFinders, index, serviceFinder);
    }

    return serviceFinder;
  };

  /**
   *  Handles requests for xapi data for different projects.
   */
  const mkHandler = function(app_prj, app_prjName, options_) {
    const projectId                 = app_prj.project.projectId;
    var   projectServicePrefix      = app_prj.project.serviceName || app_prj.project.projectName;

    return (handlers[projectId] = function(req, res, params, splats, query_, match) {
      return isClientCertOk(req, res, usersDb, (err, isOk, user) => {

        if (err)    { console.error(err); return serverassist._403(req, res); }
        if (!isOk)  {  return serverassist._403(req, res); }

        const all         = sg._extend(params || {}, query_ || {});
        const query       = _.omit(query_, 'rsvr');

        // The id of the service (like mxp_xapi_s3_1) -- (aname === s3, in this case)
        const serviceId   = _.compact([app_prjName, params.aname, params.version]).join('_');
        var serviceIdMsg  = serviceId;

        // Which stack?
        var   requestedStack = 'pub';
        var   requestedState = 'main';

        if (all.rsvr) {

          if (all.rsvr === 'stg') {
            all.rsvr = 'prodnext';
          }

          if (all.rsvr.startsWith('qa'))            { requestedStack = 'test'; }
          else if (all.rsvr.startsWith('test'))     { requestedStack = 'test'; }
          else if (all.rsvr.startsWith('pub'))      { requestedStack = 'pub'; }
          else if (all.rsvr.startsWith('prod'))     { requestedStack = 'pub'; }

          if (all.rsvr.match(/next$/i))             { requestedState = 'next'; }
        }

        const runningState  = deref(projectRunningStates, [projectId, requestedStack, requestedState]);

        return sg.__run2({}, [function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // Get the more-specific service

          const serviceFinder = getServiceFinder(projectId, projectServicePrefix, requestedStack, requestedState);

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = projectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we have not found the service, fall back (next --> main)

          if (requestedState !== 'next')  { return next(); }

          const serviceFinder = getServiceFinder(projectId, projectServicePrefix, requestedStack, 'main');

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = projectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we cannot find the service from the more-specific id, just use the base version

          if (!runningState.baseProjectServicePrefix) { return next(); }

          const serviceFinder = getServiceFinder(projectId, runningState.baseProjectServicePrefix, requestedStack, requestedState);

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = runningState.baseProjectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we still have not found the service, fall back (next --> main), using base version

          if (requestedState !== 'next')                { return next(); }
          if (!runningState.baseProjectServicePrefix)   { return next(); }

          const serviceFinder = getServiceFinder(projectId, runningState.baseProjectServicePrefix, requestedStack, 'main');

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = runningState.baseProjectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }], function last(err, result) {

          // -----------------------------------------------------------------------------------------------
          // Send the result

          return redirectToService(req, res, serviceIdMsg, err, result.location, {query});
        });

      });
    });
  };

  /**
   *  Handles any request that does not have the project Id in the url path.
   *
   *  TODO: use projectByDomainName
   */
  const handleUnProject = function(req, res, params, splats, query, match) {
    var projectId = '';

    projectId = 'sa';
    const handler = handlers[projectId];

    if (!handler) {
      console.error(`Could not find projectId for ${urlLib.parse(req.url).pathname}`);
      return serverassist._403(req, res);
    }

    /* otherwise -- let the handler handle it */
    return handler(req, res, params, splats, query, match);
  };

  //--------------------------------------------------------------------------

  /**
   *  Sets various things, based on the cluster configuration.
   */
  const reconfigure = function(r_, callback) {

    console.log(`xapi reconfiguring`);

    var   projectByDomainName_, appBySubdomain_, xapiPrefixes_, app_prjs_;

    r = r_;

    // Remember the 'sa' project (so we can associate it with mobilewebassist.net)
    var   saProject;

    // Which projects (by db record) are associated with which domain names?
    projectByDomainName_ = sg.reduce(r.db.projectRecords, {}, (m, project) => {
      if (project.projectId === 'sa')   { saProject = project; }
      if (project.uriBase)              { m = sg.kv(m, project.uriBase.split('/')[0], project); }
      if (project.uriTestBase)          { m = sg.kv(m, project.uriTestBase.split('/')[0], project); }

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
    //       { main:
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
    // console.log('-------------------------------', sg.inspect(projectRunningStates));

    // Update the global vars all at once
    projectByDomainName = projectByDomainName_;
    appBySubdomain      = appBySubdomain_;
    xapiPrefixes        = xapiPrefixes_;
    app_prjs            = app_prjs_;
    serviceFinders      = {};

    return callback();
  };

  return sg.__run([function(next) {

    //
    // Get the configuration object
    //

    getConfig(next);
    function getConfig(next_) {
      sg.setTimeout(10000, getConfig);
      const next = next_ || function(){};

      return serverassist.configuration({}, {}, (err, r_) => {

        if (sg.ok(err, r_)) {
          if (!sg.deepEqual(r_, r)) {
            return reconfigure(r_, () => {
              return next();
            });
          }
        }

        return next();
      });
    }

  }, function(next) {

    //
    //  Look at the projects and apps, and mount routes
    //
    _.each(r.result.app_prj, (app_prj, app_prjName) => {

      if (app_prj.app.appId !== appId) { return; }    /* this is not my app */

      const projectId = app_prj.project.projectId;
      const handler   = mkHandler(app_prj, app_prjName);

      _.each(xapiPrefixes, urlPrefix => {
        if (!app_prjs[`${projectId}_${urlPrefix}`]) { return; }   /* this is not my app */

        addRoute(`/:aname(${urlPrefix})`,         `/xapi/v:version/:projectId(${projectId})`,       handler, app_prjName);
        addRoute(`/:aname(${urlPrefix})`,         `/xapi/v:version/:projectId(${projectId})/*`,     handler, app_prjName);

        addRoute(`/:aname(${urlPrefix})`,         `/xapi/:projectId(${projectId})/v:version`,       handler, app_prjName);
        addRoute(`/:aname(${urlPrefix})`,         `/xapi/:projectId(${projectId})/v:version/*`,     handler, app_prjName);
      });


      addRoute(`/:projectId(${projectId})`, `/xapi/v:version`,                              handler, app_prjName);
      addRoute(`/:projectId(${projectId})`, `/xapi/v:version/*`,                            handler, app_prjName);

      addRoute(`/:projectId(${projectId})`, `/xapi`,                                        handler, app_prjName);
      addRoute(`/:projectId(${projectId})`, `/xapi/*`,                                      handler, app_prjName);

      // Add startup notification handlers

      onStart.push(function(port, myIp) {
        const myServiceLocation   = `http://${myIp}:${port}`;
        const myMount             = deref(app_prj, [myStack, myColor, 'mount']) || '';

        console.log(`${sg.pad(app_prjName, 35)} [${myServiceLocation}] (for /${myMount})`);
        registerMyService();

        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(app_prjName, myServiceLocation, myIp, 4000);
        }
      });

    });

    _.each(xapiPrefixes, urlPrefix => {
      addRoute(`/:aname(${urlPrefix})`,           `/xapi/v:version`,                              handleUnProject, `${appId} (to discover projectId)`);
      addRoute(`/:aname(${urlPrefix})`,           `/xapi/v:version/*`,                            handleUnProject, `${appId} (to discover projectId)`);
    });

    addRoute(``,                          `/xapi/v:version`,                              handleUnProject, `${appId} (to discover projectId)`);
    addRoute(``,                          `/xapi/v:version/*`,                            handleUnProject, `${appId} (to discover projectId)`);

    addRoute(``,                          `/xapi`,                                        handleUnProject, `${appId} (to discover projectId)`);
    addRoute(``,                          `/xapi/*`,                                      handleUnProject, `${appId} (to discover projectId)`);

    return next();

  }], function() {
    return callback();
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});

