
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const clientStart             = require('./client-start');
const clusterRoutes           = require('./cluster-routes');

var lib = {};

lib.addRoutes = function(router, db, callback) {
  return sg.__run([function(next) {
    return clientStart.addRoutes(router, db, next);
  }, function(next) {
    return clusterRoutes.addRoutes(router, db, next);
  }], function() {
    return callback();
  });
};

_.each(lib, (v,k) => {
  exports[k] = v;
});

