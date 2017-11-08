
/**
 *  When a request arrives to the ServerAssist cluster, the server-assist-server/webtier module
 *  handles it. The request first arrives to the NGINX process, which reverse-proxies it to the
 *  webtier.js file that hosts the Node.js http server. webtier.js looks up a `routes` handler
 *  in its `servers` table, and calls the handler.
 *
 *  That handler is setup in this module at startup time. This module calls serverassist.configuration to
 *  get a big JSON that details what the cluster looks like. This module uses that JSON to build
 *  the `servers` object.
 *
 *  At runtime, various apps are running on various stacks. When a request comes in, this module
 *  finds a running instance of the app and routes to it. It usually routes to an app within its
 *  own cluster, but not always.
 *
 *  The JSON contains information to build the mapping between fqdn/uribase and a service name.
 *  When the request arrives, this module responds to NGINX with an X-Accel-Redirect to the instance
 *  that is running the app.
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const clusterLib              = sg.include('js-cluster') || require('js-cluster');
const Router                  = require('routes');

const normlz                  = sg.normlz;
const ServiceList             = clusterLib.ServiceList;
const redirectToService       = serverassist.redirectToService;
const configuration           = serverassist.configuration;

const myIp                    = process.env.SERVERASSIST_MY_IP          || '127.0.0.1';
const utilIp                  = process.env.SERVERASSIST_UTIL_HOSTNAME  || 'localhost';
const myColor                 = process.env.SERVERASSIST_COLOR          || 'green';
const myStack                 = process.env.SERVERASSIST_STACK          || 'test';

const serviceList             = new ServiceList(['serverassist', myColor, myStack].join('-'), utilIp);

var lib = {};

/**
 *  Add FQDN and paths to the `servers` object.
 *
 *  @param {MongoClient} db       - The DB.
 *  @param {Object}      servers  - A dict of mappings between FQDN and a Router() object.
 *                                  Also has config for fqdn.
 *  @param {Object}      config   - The overall configuration.
 */
lib.addRoutesToServers = function(db, servers, config, callback) {
  return configuration({}, {}, (err, r) => {
    if (err) { return sg.die(err, callback, 'addRoutesToServers.clusterConfig.configuration'); }

    var handlers        = {};

    var   projects = {},saProject;
    const projectByDomainName = sg.reduce(r.db.projectRecords, {}, (m, project) => {
      if (project.projectId === 'sa')   { saProject = project; }
      if (project.uriBase)              { m = sg.kv(m, project.uriBase.split('/')[0], project); }
      if (project.uriTestBase)          { m = sg.kv(m, project.uriTestBase.split('/')[0], project); }

      projects[project.projectId] = project;
      return m;
    });
    projectByDomainName['mobilewebassist.net'] = saProject;
    projectByDomainName['mobiledevassist.net'] = saProject;

    const appBySubdomain = sg.reduce(r.db.appRecords, {}, (m, app) => {
      if (app.subdomain) { return sg.kv(m, app.subdomain.split('.')[0], app); }
      return m;
    });

    const serviceLists = sg.reduce(r.db.projectRecords, {}, (m, project) => {
      const serviceName = project.serviceName || project.projectName;
      if (m[serviceName])   { return m; }
      return sg.kv(m, serviceName, new ServiceList([serviceName, myColor, myStack].join('-'), utilIp));
    });

    //console.error(sg.inspect(r), myColor, myStack);

    const mkHandler_ = function(app_prjName, fqdn) {
      /**
       *  Handles requests and sends them to the right internal end-point
       *  via `X-Accel-Redirect`.
       *
       *  Uses js-cluster's services to lookup a running instance of the appropriate
       *  service; then uses `X-Accel-Redirect` to send Nginx there to retrieve the
       *  real response.
       */
      var   [projectId, appName]  = app_prjName.split('_');
      const domainName            = _.last(fqdn.split('.'), 2).join('.');
      const domainProject         = projectByDomainName[domainName];

      const handler = function(req, res, params, splats) {
        return sg.__run2({}, [function(result, next, last) {

          // First, try the more specific service name
          const projectId   = params.projectId || domainProject.projectId || projectId;
          const project     = projects[projectId] || {};
          const serviceList = serviceLists[project.serviceName || ''];

          if (!serviceList)   { return next(); }

          return serviceList.getOneService(`${projectId}_${appName}`, (err, location) => {
            if (sg.ok(err, location)) {
              result.location = location;
              return last(null, result);
            }
            return next();
          });

        }, function(result, next, last) {
          return serviceList.getOneService(app_prjName, (err, location) => {
            if (sg.ok(err, location)) {
              result.location = location;
              return last(null, result);
            }
            return next();
          });

        }], function last(err, result) {
          return redirectToService(req, res, app_prjName, err, result.location);
        });
      };

      return (handlers[app_prjName] = handler);
    };

    const stack         = r.result.subStacks[`${myColor}-${myStack}`];
    var   projectNames  = {};
    var   xapiHandler;
    var   xapiHandlerFqdn;

    const addFqdnRoute = function(name, route, handler, fqdn) {
      console.log(`${sg.pad(fqdn, 35)} ${sg.lpad(route, 55)} ->> ${name}`);
      servers[fqdn].router.addRoute(route, handler);
    };

    _.each(stack.fqdns || {}, (serverConfig, fqdn) => {
      sg.setOn(servers, [fqdn, 'router'], Router());

      const mkHandler = function(name) {
        //return (handlers[name] = mkHandler_(name, fqdn));
        return mkHandler_(name, fqdn);
      };

      const addRoute = function(name, route, handler) {
        console.log(`${sg.pad(fqdn, 35)} ${sg.lpad(route, 55)} ->> ${name}`);
        servers[fqdn].router.addRoute(route, handler);
      };

      _.each(serverConfig.app_prj || {}, (app_prjConfig, app_prjName) => {
        const [projectId, appName] = app_prjName.split('_');

        projectNames[projectId] = projectId;

        //console.log(`--configuring ${fqdn}, ${app_prjName}, /${app_prjConfig.route}`);
        const handler = mkHandler(app_prjName);

        addRoute(app_prjName, '/'+app_prjConfig.route, handler);
        addRoute(app_prjName, '/'+app_prjConfig.route+'/*', handler);

        // ---------- Special processing for core sa apps ----------

        // xapi
        if (appName === 'xapi') {
          //console.log(`    --configuring for ${projectId} ${appName}`);

          if (projectId === 'sa') {
            xapiHandler     = handler;
            xapiHandlerFqdn = fqdn;
          }

          _.each(r.db.appRecords, appRecord => {
            if (!appRecord.xapiPrefix || !r.db.appprjRecords[`${projectId}_${appRecord.appName}`]) { return; }
            addRoute(app_prjName, `/${appRecord.xapiPrefix}/${appName}/${projectId}/v:version`, handler);
            addRoute(app_prjName, `/${appRecord.xapiPrefix}/${appName}/${projectId}/v:version/*`, handler);
          });

          addRoute(app_prjName, `/${projectId}/${appName}`, handler);
          addRoute(app_prjName, `/${projectId}/${appName}/*`, handler);

        }

      });
    });

    // ---------- Special processing for core sa apps without project ----------

    // xapi
    if (xapiHandler) {

      //console.log(`--configuring ---------- ${xapiHandlerFqdn} xapi ----------`);
      _.each(r.db.appRecords, appRecord => {
        if (!appRecord.xapiPrefix) { return; }

        _.each(projectNames, projectName => {
          addFqdnRoute(`sa_xapi`, `/${appRecord.xapiPrefix}/xapi/v:version/:projectId(${projectName})`, xapiHandler, xapiHandlerFqdn);
          addFqdnRoute(`sa_xapi`, `/${appRecord.xapiPrefix}/xapi/v:version/:projectId(${projectName})/*`, xapiHandler, xapiHandlerFqdn);
        });

        addFqdnRoute(`sa_xapi`, `/${appRecord.xapiPrefix}/xapi/v:version`, xapiHandler, xapiHandlerFqdn);
        addFqdnRoute(`sa_xapi`, `/${appRecord.xapiPrefix}/xapi/v:version/*`, xapiHandler, xapiHandlerFqdn);
      });

      addFqdnRoute(`sa_xapi`, `/xapi`, xapiHandler, xapiHandlerFqdn);
      addFqdnRoute(`sa_xapi`, `/xapi/*`, xapiHandler, xapiHandlerFqdn);
    }

    _.each(stack.fqdns || {}, (serverConfig, fqdn) => {
      // ---------- More special processing for core sa apps ----------

      // The app gets to handle the root path, if it owns the subdomain (sa_console for console.mobilewebassist.net)
      _.each(serverConfig.app_prj || {}, (app_prjConfig, app_prjName) => {
        //console.log(`--configuring again ${fqdn}, ${app_prjName}, /${app_prjConfig.route}`);

        // This has to be last, or noone else can handle any routes
        if (_.last(app_prjName.split('_')) === _.first(fqdn.split('.'))) {
          if (_.first(app_prjConfig.mount.split('/')) === 'sa') {
            addFqdnRoute(app_prjName, '/*', handlers[app_prjName], fqdn);
          }
        }

      });
    });

    return callback(err, r);
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});


