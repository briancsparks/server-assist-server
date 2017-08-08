
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
const clusterLib              = sg.include('js-cluster') || require('js-cluster');
const clusterConfig           = require('../../ra-scripts/cluster-config');
const Router                  = require('routes');

const normlz                  = sg.normlz;
const ServiceList             = clusterLib.ServiceList;

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
  return clusterConfig.configuration({}, {}, (err, r) => {
    if (err) { return sg.die(err, callback, 'addRoutesToServers.clusterConfig.configuration'); }

    //console.error(sg.inspect(r), myColor, myStack);

    const mkHandler = function(app_prjName, fqdn) {
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
          if (err)          { return sg._500(req, res, null, `Internal error `+err); }
          if (!location)    { return sg._404(req, res, null, `Cannot find ${app_prjName}`); }

          const rewritten         = req.url;

          const internalEndpoint  = location.replace(/^(http|https):[/][/]/i, '');
          const redir             = normlz(`/rpxi/${req.method}/${internalEndpoint}/${rewritten}`);

          console.log(`${fqdn}: ${app_prjName} ->> ${redir}`);

          res.statusCode = 200;
          res.setHeader('X-Accel-Redirect', redir);
          res.end('');
        });
      };

      return handler;
    };

    const stack = r.result.subStacks[`${myColor}-${myStack}`];

    console.log("Routing");
    _.each(stack.fqdns || {}, (serverConfig, fqdn) => {
      sg.setOn(servers, [fqdn, 'router'], Router());

      _.each(serverConfig.app_prj || {}, (app_prjConfig, app_prjName) => {
        console.log(`Routing: ${sg.pad(fqdn, 35)} /${sg.lpad(app_prjConfig.route+'*', 30)} ->> app: ${app_prjName}`);
        const handler = mkHandler(app_prjName, fqdn);
        servers[fqdn].router.addRoute('/'+app_prjConfig.route+'*', handler);
      });
    });

    return callback(err, r);
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});


