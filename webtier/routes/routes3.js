
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
      const handler = function(req, res, params, splats) {
        return serviceList.getOneService(app_prjName, (err, location) => {
          return redirectToService(req, res, app_prjName, err, location);
        });
      };

      return handler;
    };

    const stack = r.result.subStacks[`${myColor}-${myStack}`];

    _.each(stack.fqdns || {}, (serverConfig, fqdn) => {
      sg.setOn(servers, [fqdn, 'router'], Router());

      var xapiUrlPrefixes = [];
      var xapiHandler;
      var handlers        = {};

      const mkHandler = function(name) {
        return (handlers[name] = mkHandler_(name, fqdn));
      };

      const addRoute = function(name, route, handler) {
        console.log(`${sg.pad(fqdn, 35)} ${sg.lpad(route, 55)} ->> ${name}`);
        servers[fqdn].router.addRoute(route, handler);
      };

      _.each(serverConfig.app_prj || {}, (app_prjConfig, app_prjName) => {
        const [projectId, appName] = app_prjName.split('_');

        //console.log(`--configuring ${fqdn}, ${app_prjName}, /${app_prjConfig.route}`);
        const handler = mkHandler(app_prjName);

        addRoute(app_prjName, '/'+app_prjConfig.route, handler);
        addRoute(app_prjName, '/'+app_prjConfig.route+'/*', handler);

        // ---------- Special processing for core sa apps ----------

        // xapi
        if (appName === 'xapi') {
          const xapiRec = r.db.appRecords.sa_xapi;
          //console.log(`  --configuring for ${appName}`);

          if (projectId === 'sa') {
            xapiHandler = handler;
          }

          xapiUrlPrefixes = _.toArray(xapiRec.urlPrefixes);
          _.each(xapiRec.urlPrefixes, urlPrefix => {
            addRoute(app_prjName, `/${urlPrefix}/${appName}/${projectId}/v:version`, handler);
            addRoute(app_prjName, `/${urlPrefix}/${appName}/${projectId}/v:version/*`, handler);
          });

          addRoute(app_prjName, `/${projectId}/${appName}`, handler);
          addRoute(app_prjName, `/${projectId}/${appName}/*`, handler);

        }

      });

      // ---------- Special processing for core sa apps without project ----------

      // xapi
      if (xapiHandler) {
        const appName = 'xapi';
        _.each(xapiUrlPrefixes, urlPrefix => {
          addRoute(`sa_xapi`, `/${urlPrefix}/${appName}/v:version`, xapiHandler);
          addRoute(`sa_xapi`, `/${urlPrefix}/${appName}/v:version/*`, xapiHandler);
        });

        addRoute(`sa_xapi`, `/${appName}`, xapiHandler);
        addRoute(`sa_xapi`, `/${appName}/*`, xapiHandler);
      }

      // ---------- More special processing for core sa apps ----------

      // The app gets to handle the root path, if it owns the subdomain (sa_console for console.mobilewebassist.net)
      _.each(serverConfig.app_prj || {}, (app_prjConfig, app_prjName) => {

        // This has to be last, or noone else can handle any routes
        if (_.last(app_prjName.split('_')) === _.first(fqdn.split('.'))) {
          addRoute(app_prjName, '/*', handlers[app_prjName]);
        }

      });
    });

    return callback(err, r);
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});


