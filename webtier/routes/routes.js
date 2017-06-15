
/**
 *  Finds apps and apis that are registered in the DB, and routes them to
 *  any service that is active.
 *
 *  The apps collection is a mapping between fqdn+pathroot ->> service_name. So,
 *  when a request comes in for fqdn.net/pathroot/..., it gets sent to the running service
 *  (via X-Accel-Redirect.)
 */
const sg                  = require('sgsg');
const _                   = sg._;
const MongoClient         = require('mongodb').MongoClient;
const Router              = require('routes');
const clusterLib          = require('js-cluster');

const ARGV                = sg.ARGV();
const verbose             = sg.verbose;
const lpad                = sg.lpad;
const normlz              = sg.normlz;
var   router              = Router();
const ServiceList         = clusterLib.ServiceList;

const myIp                = process.env.SERVERASSIST_MY_IP          || '127.0.0.1';
const utilIp              = process.env.SERVERASSIST_UTIL_HOSTNAME  || 'localhost';
const myColor             = process.env.SERVERASSIST_COLOR          || 'green';
const myStack             = process.env.SERVERASSIST_STACK          || 'test';

const serviceList         = new ServiceList(['serverassist', myColor, myStack].join('-'), utilIp);
var   dbHost              = process.env.SERVERASSIST_DB_HOSTNAME || 'localhost';
var   mongoUrl            = `mongodb://${dbHost}:27017/serverassist`;

var shiftBy;
var lib = {};

/**
 *  Add FQDN and paths to the `servers` object.
 */
lib.addRoutesToServers = function(servers, callback) {
  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertApp.MongoClient.connect'); }

    var projectsDb  = db.collection('projects');
    var appsDb      = db.collection('apps');
    var appQuery    = {};

    //-------------------------------------------------------------------------------------------------------------
    // Loop over the apps and make a mapping from fqdn/pathroot to a service.
    //   Use Routes for pathroot handling.
    //   Use js-cluster for the service mechanism.

    var error;
    var apps = [];
    sg.__run([function(next) {
      // In production, we only mount apps that have been vetted
      if (sg.isProduction()) {
        appQuery.vetted = true;
      }

      appsDb.find(appQuery).each((err, app) => {
        if (err)    { error = err; next(); return false; }      // return false stops the enumeration
        if (!app)   { return next(); }                          // Done

        apps.push(app);
      });

    // ---------- Exit if there was an error ----------
    }, function(next) {
      if (error) { return sg.die(error, callback, 'addRoutes.each-app'); }
      return next();

    // ---------- For each app, setup route ----------
    }], function() {

      console.log('----------------------------------------------------------------------------------------------------------------------------------------------');
      sg.__each(apps, function(app, nextApp) {

        var uriBase;

        var rewrite   = false;
        var appId     = app.appId;
        var projectId = app.projectId;
        var mount     = app.mount;

        // Make sure we have necessary components
        if (!appId)               { console.error(`No appId`); return; }
        if (!mount)               { console.error(`No mount for app: ${appId}`); return; }

        // app.projectId (and a project object from the DB) are optional in non-prod
        if (sg.isProduction()) {
          if (!projectId)           { console.error(`No projectId for app: ${appId}`); return; }
        }

        if ('rewrite' in app)     { rewrite = app.rewrite; }

        // ---------- Find uriBase from the DB (projects) ----------
        return sg.__run([function(next) {

          if (projectId) {
            // Get the associated project
            return projectsDb.find({projectId}).limit(1).each((err, project) => {
              if (err)                { return sg.die(err, callback, '.find(projectId)'); }
              if (!project)           { return next(); }

              uriBase = project.uriBase;
            });
          }

          return next();

        // ---------- Find the uriBase from the app object -----------
        }, function(next) {

          if (uriBase)              { return next(); }
          if (sg.isProduction())    { return sg.die(err, callback, 'no uriBase'); }

          productId = _.first(app.mount.split('/'));
          uriBase = `local.mobilewebassist.net/${productId}`;
          return next();

        }], function() {

          //-------------------------------------------------------------------------------------------------------------------------
          // uriBase (and uriTestBase) are the url-root of the project -- like: mobilewebassist.net/prj -- for the `prj` project

          // Fixup fqdn
          uriBase = uriBase.replace(/^salocal[.]net/, 'local.mobilewebprint.net');

          // Split the fqdn and the pathroot
          const [fqdn, root]    = shiftBy(uriBase, '/');      // or uriTestBase -- [ mobilewebassist.net, prj ]

          // Add the fqdn/route
          servers[fqdn]         = servers[fqdn]         || {};
          servers[fqdn].router  = servers[fqdn].router  || Router();

          const route = normlz(`/${mount}/*`);
          console.log(`Mounting ${lpad(appId, 20)} at ${lpad(fqdn, 20)}: ${route}`);

          //=========================================================================================================================
          // The run-time handler
          //=========================================================================================================================

          servers[fqdn].router.addRoute(route, function(req, res, params, splats) {

            // This is the function that handles the route: project.uriBase/app.mount/*
            // Use X-Accel-Redirect to tell nginx to send the request to the service.

            verbose(2, `Handling ${fqdn} ${route}:`, {params}, {splats});

            //-------------------------------------------------------------------------------------------------------------------------
            // Rewrite the url path -- so that a service can have some flexibility where it is mounted

            // Default to 'no change'
            var rewritten = req.url;

            // rewrite was set to app.rewrite above
            if (rewrite === false)                { rewritten = req.url; }        // Nothing
            else if (_.isString(rewrite))         { rewritten = normlz(`/${rewrite}/${splats}`); }        // TODO Add search

            // ---------- Get the location of the service
            return serviceList.getOneService(app.appId, (err, location) => {
              if (err) {
                res.statusCode = 404;
                res.end('Not Found');
                return;
              }

              const internalEndpoint  = location.replace(/^(http|https):[/][/]/i, '');
              const redir             = normlz(`/rpxi/${req.method}/${internalEndpoint}/${rewritten}`);

              verbose(2, `${appId} ->> ${redir}`);

              res.statusCode = 200;
              res.setHeader('X-Accel-Redirect', redir);
              res.end('');
            });
          });

          return nextApp();
        });

      }, function() {
        console.log('----------------------------------------------------------------------------------------------------------------------------------------------\n');
        return callback(null);
      });
    });
  });
};

shiftBy = function(str, sep_) {
  const sep    = sep_ || '/';
  const parts  = str.split(sep);
  const first  = parts.shift();

  return [first, parts.join(sep)];
};

_.each(lib, (value, key) => {
  exports[key] = value;
});

