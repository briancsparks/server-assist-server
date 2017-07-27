
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
const deref                   = sg.deref;
const setOnn                  = sg.setOnn;
const argvExtract             = sg.argvExtract;
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
lib.addRoutesToServers = function(db, servers, config, callback) {
  config.servers  = servers;

  var projectsDb  = db.collection('projects');
  var stacksDb    = db.collection('stacks');
  var appsDb      = db.collection('apps');
  var appQuery    = {};

  return stacksDb.find({stack:myStack, color:{$not:{$exists:true}}}).toArray((err, stacks_) => {
    if (err)                    { return sg.die(err, callback, 'addRoutesToServers.each-stack'); }

    // Update the config with stack-related info
    var stacks = sg.reduce(stacks_, {}, (m, stack) => {

      sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useHttp'],             stack.useHttp);
      sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useHttps'],            stack.useHttps);
      sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useTestName'],         stack.useTestName);
      sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'requireClientCerts'],  stack.requireClientCerts);

      return sg.kv(m, stack.stack, stack);
    });

    const confStack = config.confStack = deref(config, ['stacks', config.stack]) || {};

    return projectsDb.find({}, {_id:0}).toArray((err, projects_) => {
      if (err) { return sg.die(err, callback, 'addRoutesToServers.each-project'); }

      // Make dictionary of projects indexed by project id
      var projects = sg.reduce(projects_, {}, (m, project_) => {
        const projectId       = project_.projectId    || '';
        const myConfStack     = confStack[projectId]  || {};
        var   project2        = sg.deepCopy(project_);
        var   project         = {};

        const uriNormBase     = argvExtract(project2, 'uriBase');
        const uriTestBase     = argvExtract(project2, 'uriTestBase');

        const uriBase         = (myConfStack.useTestName === true) ? uriTestBase : uriNormBase;

        const [pqdn, urlPath] = shiftBy(uriBase, '/');

        setOnn(config, ['project', projectId, 'urlPath'],   urlPath);
        setOnn(project,                       'urlPath',    _.compact(urlPath.split('/')));

        setOnn(config, ['project', projectId, 'pqdn'],      pqdn);
        setOnn(project,                       'pqdn',       pqdn);

        _.each(project2, (value, key) => {
          setOnn(config, ['project', projectId, key],       value);
          setOnn(project,                       key,        value);
        });

        return sg.kv(m, projectId, project);
      });

      return stacksDb.find({stack:myStack, color:{$exists:true}}).toArray((err, instances) => {
        if (err) { return sg.die(err, callback, 'addRoutesToServers.each-instance'); }

        return appsDb.find({}).toArray((err, apps_) => {
          if (err) { return sg.die(err, callback, 'addRoutesToServers.each-app'); }

          var apps = sg.reduce(apps_, {}, (m, app) => {

            app.stacks = sg.reduce(app.stacks, {}, (m, stack) => { return sg.kv(m, stack, stack); });
            if ((config.stack in app.stacks) || sg.numKeys(app.stacks) !== 0) {
              // This app does not run on this stack.
              return m;
            }

            if (app.subdomain) {
              const project = projects[app.projectId];
              const pqdn    = (project || {}).pqdn    || 'mobilewebassist.net';
              const xqdn    = _.compact(`${app.subdomain}.${pqdn}`.split('.')).join('.');;

              if (xqdn === pqdn) {
                app.pqdn = pqdn;
              } else {
                app.fqdn = xqdn;
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

            // Apps may work with more than one project
            var appProjectIds = [app.projectId];

            const hostProject = projects[app.projectId];
            _.each(appProjectIds, appProjectId => {
              const project           = projects[appProjectId];
              const projectConfStack  = confStack[project.projectId];
              var   urlPath           = app.urlPath.slice();
              var   fqdn;

              if (app.fqdn) {
                fqdn = app.fqdn;
              } else if (project.deployStyle === 'greenBlueByService') {
                fqdn = `${myColor}-${myStack}.${app.pqdn}`;
              } else {
                fqdn = (project || {}).pqdn    || 'apps.mobilewebassist.net';
              }

              if (!fqdn)  { console.error(`No project.fqdn for ${app.projectId}`); return; }

              if (_.last(hostProject.urlPath) === urlPath[0]) {
                urlPath.shift();
              }
              urlPath = project.urlPath.concat(urlPath);
              const mount = urlPath.join('/');

              // Add the fqdn/route
              sg.setOn(servers, [fqdn, 'router'], Router());
              sg.setOn(servers, [fqdn, 'config'], projectConfStack);

              const route = normlz(`/${mount}/*`);
              console.log(`Mounting ${lpad(appId, 20)} at ${pad(fqdn, 49)} ${route}`);

              servers[fqdn].router.addRoute(route, mkHandler(fqdn, route));

            });
          });

          return callback();

        });
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


