
/**
 *  Finds apps and apis that are registered in the DB, and routes them to
 *  any service that is active.
 *
 *  The apps collection is a mapping between fqdn+pathroot ->> service_name. So,
 *  when a request comes in for fqdn.net/pathroot/..., it gets sent to the running service
 *  (via X-Accel-Redirect.)
 */
const sg                      = require('sgsg');
const _                       = sg._;
const urlLib                  = require('url');
const serverassist            = sg.include('serverassist') || require('serverassist');
const MongoClient             = require('mongodb').MongoClient;
const Router                  = require('routes');
const clusterLib              = require('js-cluster');

const ARGV                    = sg.ARGV();
const verbose                 = sg.verbose;
const lpad                    = sg.lpad;
const pad                     = sg.pad;
const normlz                  = sg.normlz;
var   router                  = Router();
const ServiceList             = clusterLib.ServiceList;
const isLocalWorkstation      = serverassist.isLocalWorkstation;

const myIp                    = process.env.SERVERASSIST_MY_IP          || '127.0.0.1';
const utilIp                  = process.env.SERVERASSIST_UTIL_HOSTNAME  || 'localhost';
const myColor                 = process.env.SERVERASSIST_COLOR          || 'green';
const myStack                 = process.env.SERVERASSIST_STACK          || 'test';

const serviceList             = new ServiceList(['serverassist', myColor, myStack].join('-'), utilIp);

var shiftBy;
var lib = {};

/**
 *  Add FQDN and paths to the `servers` object.
 */
lib.addRoutesToServers = function(db, servers, apps, callback) {

  var projectsDb  = db.collection('projects');
  var appsDb      = db.collection('apps');
  var appQuery    = {};

  return projectsDb.find({}).toArray((err, projects_) => {
    if (err) { return sg.die(err, callback, 'addRoutesToServers.each-project'); }

    var serverRecords = {};
    var projects = sg.reduce(projects_, {}, (m, project) => {
      const [fqdn, urlPath] = shiftBy(project.uriBase, '/');
      serverRecords[fqdn] = fqdn;

      project.fqdn = fqdn;
      project.urlPath    = _.compact(urlPath.split('/'));
      return sg.kv(m, project.projectId, project);
    });

    return appsDb.find({}).toArray((err, apps_) => {
      if (err) { return sg.die(err, callback, 'addRoutesToServers.each-app'); }

      var apps = sg.reduce(apps_, {}, (m, app) => {

        if (app.subdomain) {
          const project = projects[app.projectId];
          var   fqdn    = (project || {}).fqdn;
          if (fqdn) {
            fqdn = _.compact(`${app.subdomain}.${fqdn}`.split('.')).join('.');
            app.fqdn = fqdn;
            serverRecords[fqdn] = fqdn;
          }
        }

        app.urlPath = _.compact(app.mount.split('/'));
        return sg.kv(m, app.appId, app);
      });

      _.each(apps, (app, appId) => {

        const mkHandler = function(fqdn, route) {
          const handler = function(req, res, params, splats) {
            return serviceList.getOneService(app.appId, (err, location) => {
              if (err)          { return sg._500(req, res, null, `Internal error `+err); }
              if (!location)    { return sg._404(req, res, null, `Cannot find ${app.appId}`); }

              const rewritten         = req.url;

              const internalEndpoint  = location.replace(/^(http|https):[/][/]/i, '');
              const redir             = normlz(`/rpxi/${req.method}/${internalEndpoint}/${rewritten}`);

              verbose(2, `${fqdn}: ${appId} ->> ${redir}`);

              res.statusCode = 200;
              res.setHeader('X-Accel-Redirect', redir);
              res.end('');
            });
          };
          return handler
        };

        const project = projects[app.projectId];
        const fqdn    = app.fqdn || (project || {}).fqdn;
        var   urlPath = app.urlPath.slice();

        if (!fqdn)  { console.error(`No project.fqdn for ${app.projectId}`); return; }

        if (_.last(project.urlPath) === urlPath[0]) {
          urlPath.shift();
        }
        urlPath = project.urlPath.concat(urlPath);
        const mount = urlPath.join('/');

        // Add the fqdn/route
        servers[fqdn]         = servers[fqdn]         || {};
        servers[fqdn].router  = servers[fqdn].router  || Router();

        var x = servers[fqdn].router;

        const route = normlz(`/${mount}/*`);
        console.log(`Mounting ${lpad(appId, 20)} at ${pad(fqdn, 49)} ${route}`);

        servers[fqdn].router.addRoute(route, mkHandler(fqdn, route));
      });

      return callback();

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


