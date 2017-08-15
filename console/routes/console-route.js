
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const clusterLib              = sg.include('js-cluster')   || require('js-cluster');
const clusterConfig           = require('../../ra-scripts/cluster-config');
const urlLib                  = require('url');

const normlz                  = sg.normlz;
const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const redirectToService       = serverassist.redirectToService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const registerAsService       = serverassist.registerAsService;
const myIp                    = serverassist.myIp();
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const utilIp                  = serverassist.utilIp();
const ServiceList             = clusterLib.ServiceList;


const appId                   = 'sa_console';
const mount                   = '*';
const projectId               = 'sa';

const appRecord = {
  projectId,
  mount,
  appId,
  route               : '*',
  isAdminApp          : true,
  useHttp             : false,
  useHttps            : true,
  requireClientCerts  : true,
  subdomain           : 'console.'
};

var lib = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {

  const usersDb                 = db.collection('users');
  const stacksDb                = db.collection('stacks');

  var   r;
  var   systemServiceInstances  = {};
  var   serviceFinders          = {};

  const mkHandler = function(kind, options_) {
    const options         = options_ || {};
    const rewriteIsSplats = options.rewriteIsSplats || false;

    return function(req, res, params, splats, query, match) {

      // Nginx might be configured to allow client certs 'optionally' -- however, they are not optional
      const clientVerify = req.headers['x-client-verify'];
      if (!clientVerify)                                      { return serverassist._403(req, res); }
      if (clientVerify !== 'SUCCESS')                         { return serverassist._403(req, res); }

      const subject         = req.headers['x-client-s-dn'];
      const subjDn          = sg.parseOn2Chars(subject, '/', '=');

      if (!subjDn.CN)                                         { return serverassist._403(req, res); }
      return usersDb.find({username:subjDn.CN}).toArray((err, users) => {
        if (err)                                              { return serverassist._403(req, res); }
        var user = (users || [])[0] || {};

        const fqdn            = req.headers.host;
        const domainName      = _.last(fqdn.split('.'), 2).join('.');
        const url             = urlLib.parse(req.url, true);

        var { project, app, version }  = params;
        var projectId         = project;

        // Make sure we have a project
        if (!projectId) {
          projectId = sg.reduce(r.result.app_prj, null, (m, app_prj, app_prjName) => {
            if (m)  { return m; }
            const p = app_prj.project;
            project = p;

            if (p.pqdn === domainName)                          { return p.projectId; }
            if ((p.uriBase || '').startsWith(domainName))       { return p.projectId; }
            if ((p.uriTestBase || '').startsWith(domainName))   { return p.projectId; }

            return m;
          });
        }
        //console.log(params, splats, project, app);

        if (!projectId)                                         { return serverassist._403(req, res); }

        const app_prjName = _.compact([projectId, kind, app, version]).join('_');
        const projectName = 'serverassist';

        // ---------- Get the service finder ----------
        const systemServiceInstances_ = _.toArray(systemServiceInstances[projectId].all);
        const serviceFinder = deref(serviceFinders, [projectName]) ||  serverassist.getServiceFinder(projectName, systemServiceInstances_);
        setOnn(serviceFinders, [projectName], serviceFinder);

        return serviceFinder.getOneServiceLocation(app_prjName, (err, location) => {
          return redirectToService(req, res, app_prjName, err, location, rewriteIsSplats && `/${splats.join('/')}`);
        });
      });
    };
  };

  const consoleHandler  = mkHandler('console', {rewriteIsSplats:true});
  const xapiHandler     = mkHandler('xapi');



  sg.__run([function(next) {
    registerAsServiceApp(appId, mount, appRecord, next);

  }, function(next) {

    runConfig(next);
    function runConfig(next_) {
      sg.setTimeout(10000, runConfig);

      //console.log('Reconfiguring');

      const next = next_ || function(){};
      return clusterConfig.configuration({}, {}, (err, r_) => {
        if (err) { return sg.die(err, callback, 'addRoutesToServers.clusterConfig.configuration'); }

        r = r_;
        //console.log(sg.inspect(r.result.app_prj));
        //console.log(sg.inspect(r));

        // Make a temp, to build-up new ssi
        var projects  = {};
        var ssi       = {};
        _.each(r.db.instanceRecords, (instance) => {
          const { projectId, stack, state } = instance;

          projects[projectId] = projectId;
          ssi[projectId]      = ssi[projectId] || {prod:[null,null,null,null], staging:[null,null,null,null], test:[null,null,null,null], test_next:[null,null,null,null], all:[null,null,null,null]};

          var prod            = ssi[projectId].prod;
          var staging         = ssi[projectId].staging;
          var test            = ssi[projectId].test;
          var test_next       = ssi[projectId].test_next;
          var all             = ssi[projectId].all;

          if      (stack === 'pub' && state === 'main')    { all[0] = prod[0]       = instance; staging.push(instance); }
          else if (stack === 'pub' && state === 'next')    { all[1] = staging[1]    = instance; }
          else if (stack === 'test' && state === 'main')   { all[2] = test[2]       = instance; }
          else if (stack === 'test' && state === 'next')   { all[3] = test_next[3]  = instance; }
          else if (state !== 'gone')                       { all.push(instance); }
        });

        _.each(_.keys(projects), projectId => {
          _.each(_.keys(ssi[projectId]), key => {
            ssi[projectId][key] = _.compact(ssi[projectId][key]);
          });
        });

        systemServiceInstances  = sg.extend(ssi);
        serviceFinders          = {};

        return next();
      });
    }

  }, function(next) {
    // Add routes

    // Add a root route for each project
    _.each(r.result.app_prj, (app_prj, app_prjName) => {
      if (app_prj.app.appId === appId) {
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/xapi/v:version',   xapiHandler);
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/xapi/v:version/*', xapiHandler);

        addRoute(`/:project(${app_prj.project.projectId})`, '/:app',                  consoleHandler);
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/*',                consoleHandler);
      }
    });

    addRoute('', '/:app/xapi/v:version',    xapiHandler);
    addRoute('', '/:app/xapi/v:version/*',  xapiHandler);

    addRoute('', '/:app',                   consoleHandler);
    addRoute('', '/:app/*',                 consoleHandler);

    addRoute('', '/*',                      consoleHandler);

    return next();

  }, function(next) {

    _.each(r.result.app_prj, (app_prj, app_prjName) => {
      if (app_prj.app.appId === appId) {

        // Add startup notification handlers
        onStart.push(function(port, myIp) {
          const myServiceLocation   = `http://${myIp}:${port}`;

          console.log(`${sg.pad(app_prjName, 30)} : [${myServiceLocation}/${mount}]`);
          registerMyService();

          function registerMyService() {
            setTimeout(registerMyService, 750);
            registerAsService(app_prjName, myServiceLocation, myIp, 4000);
          }
        });
      }
    });

    return next();
  }], function() {
    return callback();
  });
};



_.each(lib, (v,k) => {
  exports[k] = v;
});

function dumpReq(req, res) {
//  if (sg.verbosity() >= 3) {
    console.log('-------------------------------------------------------');
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('-------------------------------------------------------');
//  }
};


