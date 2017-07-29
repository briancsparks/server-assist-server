
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

var shiftBy, keyMirror;
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

  return projectsDb.find({}, {_id:0}).toArray((err, projects_) => {
    if (err) { return sg.die(err, callback, 'addRoutesToServers.each-project'); }

    // Make an un-processed list of projects that simply indexes them by projectId
    var rawProjects = sg.reduce(projects_, {}, (m, project_) => {
      return sg.kv(m, project_.projectId, sg.deepCopy(project_));
    });

    return stacksDb.find({stack:myStack, color:{$not:{$exists:true}}}).toArray((err, stacks_) => {
      if (err)                    { return sg.die(err, callback, 'addRoutesToServers.each-stack'); }

      var stacksByProjectId = sg.reduce(stacks_, {}, (m, stack) => {
        return sg.kv(m, stack.projectId, stack);
      });

      // If any projects are missing from the stacks defs, add them
      var stacks = sg.reduce(_.keys(rawProjects), stacks_, (m, projectId) => {

        // If we already have it, just return the list as-is
        if (projectId in stacksByProjectId) { return m; }

        /* otherwise -- we must add it */
        if (stacksByProjectId.sa) {
          m.push(sg.extend(stacksByProjectId.sa, {projectId}));
        }

        return m;
      });

      // Update the config with stack-related info
      stacks = sg.reduce(stacks, {}, (m, stack) => {
        const project = rawProjects[stack.projectId];

        _.each(_.keys(rawProjects), projectId => {
          sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'projectName'],         project.name || (project.uriBase.split('.')[0]));
          sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useHttp'],             stack.useHttp);
          sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useHttps'],            stack.useHttps);
          sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'useTestName'],         stack.useTestName);
          sg.setOnn(config, ['stacks', stack.stack, stack.projectId, 'requireClientCerts'],  stack.requireClientCerts);
        });

        return sg.kv(m, stack.stack, stack);
      });

      const confStack = config.confStack = deref(config, ['stacks', config.stack]) || {};

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

          //
          //  Fixup the app object, and filter out any that are not for this stack
          //

          var apps = sg.reduce(apps_, {}, (m, app) => {

            // The app has a list of stacks it can run on, as a string array. Turn it into a key-mirror.
            app.runsOn = sg.reduce(app.runsOn, {}, (m, stack) => { return sg.kv(m, stack, stack); });

            if (app.isAdminApp)   { app.runsOn.cluster        = 'cluster'; }
            if (app.runsOn.all)   { app.runsOn[config.stack]  = config.stack; }

            // Is app configured to run on this stack?
            if (!(config.stack in app.runsOn)) {
              return m;
            }

            // If the stack is an admin stack, then only admin apps can run on it.
            if (stacks[config.stack].isAdminStack && !(app.isAdminApp === true)) {
              return m;
            }

            // Remember the app's URL path as an array of strings
            app.urlPath = _.compact(app.mount.split('/'));

            return sg.kv(m, app.appId, app);
          });

          _.each(apps, (app, appId) => {

            const mkHandler = function(appId, fqdn, route, fqdnConf) {

              // Add the fqdn/route
              sg.setOn(servers, [fqdn, 'router'], Router());
              sg.setOn(servers, [fqdn, 'config'], fqdnConf);

              console.log(`Mounting ${lpad(appId, 20)} at ${pad(fqdn, 49)} ${route}`);

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

            //
            // All of the above was just a warm-up. Here is where the stacks get determined
            //
            //  Basically, it is up to the apps to build the servers object. We are currently
            //  looping over all the apps that remain for this stack. Shortly below, we are
            //  looping over all the projects that the app wants to loop over. Above are two
            //  functions (mkHandler, and addFqdn). Those cause servers to be made and handled.
            //

            // Apps may work with more than one project
            var appProjectIds = sg.kv(app.projectId, app.projectId);

            if (app.mount && (app.mount[0] === '*')) {
              appProjectIds = sg.extend(appProjectIds, keyMirror(_.keys(projects)));
            }

            const hostProject = projects[app.projectId];
            _.each(appProjectIds, appProjectId => {
              const project           = projects[appProjectId];
              const projectConfStack  = confStack[project.projectId];
              var   urlPath           = app.urlPath.slice();
              var   xqdn;
              var   handler;

              if (_.last(hostProject.urlPath) === urlPath[0] || urlPath[0] === '*') {
                urlPath.shift();
              }
              urlPath = project.urlPath.concat(urlPath);

              const mount = urlPath.join('/');
              const route = normlz(`/${mount}/*`);

              //
              //  For each app/project, there are potentially 2 fqdns:
              //    1. color-stack.project-domain
              //    2. app-subdomain.project-domain
              //

              const pqdn = (project || {}).pqdn || 'mobilewebassist.net'

              // Does the app claim to need a sub-domain?
              if (app.subdomain) {
                if ((xqdn = _.compact(`${app.subdomain}.${pqdn}`.split('.')).join('.')) !== pqdn) {
                  handler = mkHandler(appId, xqdn, route, projectConfStack);
                  servers[xqdn].router.addRoute(route, handler);
                }
              }

              var fqdn = '';
              if (project.deployStyle === 'greenBlueByService') {
                fqdn = `${myColor}-${myStack}.${pqdn}`;
              } else {
                fqdn = `apps.${pqdn}`;
              }

              if (fqdn) {
                handler = mkHandler(appId, fqdn, route, projectConfStack);
                servers[fqdn].router.addRoute(route, handler);
              }

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

keyMirror = function(arr) {
  return sg.reduce(arr, {}, (m, x) => {
    return sg.kv(m, x, x);
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});


