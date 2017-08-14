
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

var serviceFinders = {};

var lib = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {
  var r;

  const usersDb       = db.collection('users');
  const stacksDb      = db.collection('stacks');

  const mkHandler = function(kind) {
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

        var { project, app }  = params;
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

        const app_prjName = `${projectId}_${kind}_${app}`;

        const projectName = 'serverassist';
        const serviceFinder = deref(serviceFinders, [projectName]) ||  serverassist.getServiceFinder(projectName, ['all']);

        setOnn(serviceFinders, [projectName], serviceFinder);

        return serviceFinder.getOneServiceLocation(app_prjName, (err, location) => {
          if (err)          { return sg._500(req, res, null, `Internal error `+err); }
          if (!location) {
            console.error(`Cannot find ${app_prjName}`);
            return sg._404(req, res, null, `Cannot find ${app_prjName}`);
          }

          if (splats.length === 0) {
            dumpReq(req, res);
          }

          const rewritten         = `/${splats.join('/')}`;

          const internalEndpoint  = location.replace(/^(http|https):[/][/]/i, '');
          const redir             = normlz(`/rpxi/${req.method}/${internalEndpoint}/${rewritten}`);

          console.log(`${fqdn}: ${app_prjName} ->> ${redir}`);

          res.statusCode = 200;
          res.setHeader('X-Accel-Redirect', redir);
          res.end('');
        });
      });
    };
  };

  const consoleHandler = mkHandler('console');
  const xapiHandler = mkHandler('xapi');



  sg.__run([function(next) {
    registerAsServiceApp(appId, mount, appRecord, next);

  }, function(next) {

    return clusterConfig.configuration({}, {}, (err, r_) => {
      if (err) { return sg.die(err, callback, 'addRoutesToServers.clusterConfig.configuration'); }

      r = r_;
      //console.log(r.result.app_prj);
      return next();
    });

  }, function(next) {
    // Add routes

    // Add a root route for each project
    _.each(r.result.app_prj, (app_prj, app_prjName) => {
      if (app_prj.app.appId === appId) {
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/xapi', consoleHandler);
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/xapi/*', consoleHandler);

        addRoute(`/:project(${app_prj.project.projectId})`, '/:app', consoleHandler);
        addRoute(`/:project(${app_prj.project.projectId})`, '/:app/*', consoleHandler);
      }
    });

    addRoute('', '/:app/xapi', xapiHandler);
    addRoute('', '/:app/xapi/*', xapiHandler);

    addRoute('', '/:app', consoleHandler);
    addRoute('', '/:app/*', consoleHandler);

    addRoute('', '/*', consoleHandler);

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


