
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;

var lib = {};

lib.addRoutes = function(addRoute, db, callback) {
  return callback();
};

_.each(lib, (v,k) => {
  exports[k] = v;
});

