
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
};

_.each(lib, (value, key) => {
  exports[key] = value;
});


