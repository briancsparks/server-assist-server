
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const urlLib                  = require('url');
const qsLib                   = require('querystring');
const serverassist            = sg.include('serverassist') || require('serverassist');
const util                    = require('util');
const helper                  = require('../../console/helper');

const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const isClientCertOk          = serverassist.isClientCertOk;
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsService       = serverassist.registerAsService;
const redirectToService       = serverassist.redirectToService;
const mkServiceFinder2        = serverassist.mkServiceFinder2;
const reconfigure             = helper.reconfigure;

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

var   lib             = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {
  var   r;

  var   projectByDomainName, appBySubdomain, xapiPrefixes, app_prjs, knownProjectIds;

  var   projectRunningStates = {};

  var   projects       = {};
  const usersDb        = db.collection('users');

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

  // Remember the handlers by projectId
  var   handlers         = {};

  /**
   *  Handles requests for xapi data for different projects.
   */
  const mkHandler = function(app_prj, app_prjName, options_) {
    const projectId                 = app_prj.project.projectId;
    var   projectServicePrefix      = app_prj.project.serviceName || app_prj.project.projectName;

    return (handlers[projectId] = function(req, res, params, splats, query_, match) {
      return isClientCertOk(req, res, usersDb, (err, isOk, user) => {

        if (err)    { console.error(err); return serverassist._403(req, res); }
        if (!isOk)  { return serverassist._403(req, res); }

        // Figure out the parameters for the request (as opposed to what was
        // setup when calling mkHandler)
        const reqProjectId            = params.projectId || projectId;
        const reqProjectServicePrefix = (knownProjectIds[reqProjectId] || {}).serviceNamespace || projectServicePrefix;
        const reqApp_prjName          = app_prjName.replace(projectId, reqProjectId);

        const all           = sg._extend(params || {}, query_ || {});
        const query         = _.omit(query_, 'rsvr');

        // The id of the service (like mxp_xapi_s3_1) -- (aname === s3, in this case)
        const serviceId     = _.compact([reqApp_prjName, params.aname, params.version]).join('_');
        var serviceIdMsg    = serviceId;

        // Which stack?
        const [ requestedStack, requestedState ] = serverassist.decodeRsvr(all.rsvr);

        const runningState  = deref(projectRunningStates, [reqProjectId, requestedStack, requestedState]);

        // Find service
        return sg.__run2({}, [function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // Get the more-specific service
          //
          //    mobilewebprint:mwp_xapi_telemetry_1
          //            netlab:ntl_xapi_telemetry_1

          const serviceFinder = getServiceFinder(reqProjectId, reqProjectServicePrefix, requestedStack, requestedState);

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = reqProjectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we have not found the service, fall back (next --> main)

          if (requestedState !== 'next')  { return next(); }

          const serviceFinder = getServiceFinder(reqProjectId, reqProjectServicePrefix, requestedStack, 'main');

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              serviceIdMsg    = reqProjectServicePrefix+':'+serviceIdMsg;
              result.location = location;

              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we cannot find the service from the more-specific id, just use the base version

          if (!runningState.baseProjectServicePrefix) { return next(); }

          const serviceFinder = getServiceFinder(reqProjectId, runningState.baseProjectServicePrefix, requestedStack, requestedState);

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

          const serviceFinder = getServiceFinder(reqProjectId, runningState.baseProjectServicePrefix, requestedStack, 'main');

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
    var   projectId = 'sa';

    const nextRouteSegment = _.compact(splats.join('/').split('/'))[0];

    if (nextRouteSegment in knownProjectIds) {
      projectId = nextRouteSegment;
    }

    // Update the matched routing object
    match.params.projectId  = projectId;
    params.projectId        = projectId;

    var   handler = handlers[projectId];

    if (!handler) {
      handler = handlers.sa;
    }

    if (!handler) {
      console.error(`Could not find projectId for ${urlLib.parse(req.url).pathname}`);
      return serverassist._403(req, res);
    }

    /* otherwise -- let the handler handle it */
    return handler(req, res, params, splats, query, match);
  };

  //--------------------------------------------------------------------------

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

            const newConfiguration = reconfigure('xapi', r = r_, projects, projectRunningStates);

            projectByDomainName = newConfiguration.projectByDomainName;
            appBySubdomain      = newConfiguration.appBySubdomain;
            xapiPrefixes        = newConfiguration.xapiPrefixes;
            app_prjs            = newConfiguration.app_prjs;
            knownProjectIds     = newConfiguration.knownProjectIds;

            serviceFinders      = {};
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

