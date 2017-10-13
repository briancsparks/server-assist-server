
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const urlLib                  = require('url');
const serverassist            = sg.include('serverassist') || require('serverassist');

const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const isClientCertOk          = serverassist.isClientCertOk;
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const registerAsService       = serverassist.registerAsService;
const redirectToService       = serverassist.redirectToService;

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
  var   serviceFinders = {};

  var   projectByDomainName, appBySubdomain, xapiPrefixes, app_prjs;

  var   projects       = {};
  const usersDb        = db.collection('users');

  // Remember the handlers by projectId
  var   handlers = {};

  /**
   *  Handles requests for xapi data for different projects.
   */
  const mkHandler = function(app_prj, app_prjName, options_) {
    const projectId    = app_prj.project.projectId;
    var   serviceName  = app_prj.project.serviceName || app_prj.project.projectName;

    return (handlers[projectId] = function(req, res, params, splats, query, match) {
      return isClientCertOk(req, res, usersDb, (err, isOk, user) => {

        if (err)    { console.error(err); return serverassist._403(req, res); }
        if (!isOk)  {  return serverassist._403(req, res); }

        // The id of the service (like mxp_xapi_s3_1) -- (tname === s3, in this case)
        const serviceId   = _.compact([app_prjName, params.aname, params.version]).join('_');

        /* otherwise */
        var   serviceFinder = deref(serviceFinders, [serviceName]) || setOnn(serviceFinders, serviceName, serverassist.mkServiceFinder(serviceName, null, "prod,or_test", r));

        return sg.__run2({}, [function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // Get the more-specific service

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              result.location = location;
              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {

          // -----------------------------------------------------------------------------------------------
          // If we cannot find the service from the more-specific id, just use the serverassist version

          serviceName   = 'serverassist';
          serviceFinder = deref(serviceFinders, [serviceName]) || setOnn(serviceFinders, serviceName, serverassist.mkServiceFinder(serviceName, null, "prod,or_test", r));

          return serviceFinder.getOneServiceLocation(serviceId, (err, location) => {
            if (sg.ok(err, location)) {
              result.location = location;
              return last(null, result);
            }
            return next();
          });

        }], function last(err, result) {

          // -----------------------------------------------------------------------------------------------
          // Send the result

          return redirectToService(req, res, serviceId, err, result.location);
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

  return sg.__run([function(next) {

    //
    // Get the configuration object
    //

    getConfig(next);
    function getConfig(next_) {
      sg.setTimeout(10000, getConfig);
      const next = next_ || function(){};

      return serverassist.configuration({}, {}, (err, r_) => {

        if (err)                    { console.error(err); return; }  // Just try again next timeout

        r = r_;

        var   saProject;
        projectByDomainName = sg.reduce(r.db.projectRecords, {}, (m, project) => {
          if (project.projectId === 'sa')   { saProject = project; }
          if (project.uriBase)              { m = sg.kv(m, project.uriBase.split('/')[0], project); }
          if (project.uriTestBase)          { m = sg.kv(m, project.uriTestBase.split('/')[0], project); }

          projects[project.projectId] = project;
          return m;
        });
        projectByDomainName['mobilewebassist.net'] = saProject;
        projectByDomainName['mobiledevassist.net'] = saProject;

        appBySubdomain = sg.reduce(r.db.appRecords, {}, (m, app) => {
          if (app.subdomain) { return sg.kv(m, app.subdomain.split('.')[0], app); }
          return m;
        });

        xapiPrefixes = sg.reduce(r.db.appRecords, [], (m, app) => {
          return sg.ap(m, deref(app, ['xapiPrefix']));
        });

        app_prjs = sg.reduce(r.db.appprjRecords, {}, (m, appprj) => {
          return sg.kv(m, appprj.appProjectId, appprj);
        });

        return next();
      });
    }

  }, function(next) {

    var my_app_prj = r.result.app_prj[appId];


    var   projectNames  = {};
    _.each(r.result.app_prj, (app_prj, app_prjName) => {
      const projectId           = app_prj.project.projectId;
      projectNames[projectId]   = projectId;
    });

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

