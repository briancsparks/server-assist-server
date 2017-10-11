
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

const xapiPrefixes    = 'telemetry,attrstream'.split(',').map(x => `:tname(${x})`);

var   lib             = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {
  var   r;
  var   serviceFinders = {};

  const usersDb        = db.collection('users');

  // Remember the handlers by projectId
  var   handlers = {};

  /**
   *  Handles requests for xapi data for different projects.
   */
  const mkHandler = function(app_prj, app_prjName, options_) {
    const projectId   = app_prj.project.projectId;
    const projectName = app_prj.project.projectNameCommon || app_prj.project.projectName;

    return (handlers[projectId] = function(req, res, params, splats, query, match) {
      return isClientCertOk(req, res, usersDb, (err, isOk, user) => {
        if (err)    { console.error(err); return serverassist._403(req, res); }
        if (!isOk)  {  return serverassist._403(req, res); }

        /* otherwise */
        const serviceFinder = deref(serviceFinders, [projectName]) || setOnn(serviceFinders, projectName, serverassist.mkServiceFinder(projectName, null, "prod,or_test", r));

        const serviceName = _.compact([app_prjName, params.tname, params.version]).join('_');
        return serviceFinder.getOneServiceLocation(serviceName, (err, location) => {
          return redirectToService(req, res, serviceName, err, location);
        });
      });
    });
  };

  /**
   *  Handles any request that does not have the project Id in the url path.
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
        return next();
      });
    }

  }, function(next) {

    var my_app_prj = r.result.app_prj[appId];

    //
    //  Look at the projects and apps, and mount routes
    //
    _.each(r.result.app_prj, (app_prj, app_prjName) => {

      if (app_prj.app.appId !== appId) { return; }    /* this is not my app */

      const projectId = app_prj.project.projectId;
      const handler   = mkHandler(app_prj, app_prjName);

      _.each(xapiPrefixes, urlPrefix => {
        addRoute(`/${urlPrefix}`,         `/xapi/:project(${projectId})/v:version`,       handler, app_prjName);
        addRoute(`/${urlPrefix}`,         `/xapi/:project(${projectId})/v:version/*`,     handler, app_prjName);
      });

      addRoute(`/:project(${projectId})`, `/xapi/v:version`,                              handler, app_prjName);
      addRoute(`/:project(${projectId})`, `/xapi/v:version/*`,                            handler, app_prjName);

      addRoute(`/:project(${projectId})`, `/xapi`,                                        handler, app_prjName);
      addRoute(`/:project(${projectId})`, `/xapi/*`,                                      handler, app_prjName);

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
      addRoute(`/${urlPrefix}`,           `/xapi/v:version`,                              handleUnProject, `${appId} (to discover projectId)`);
      addRoute(`/${urlPrefix}`,           `/xapi/v:version/*`,                            handleUnProject, `${appId} (to discover projectId)`);
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

