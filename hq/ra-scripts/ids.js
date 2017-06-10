
/**
 *
 */
var sg                    = require('sgsg');
var _                     = sg._;

var libIds = {};

libIds.getIds = function(argv, context, callback_) {
  var callback  = callback_     || function() {};
  var body      = argv.body     || {};
  var match     = argv.match    || {};
  var params    = match.params  || {};

  var result = {};

  if (body.projectId)       { result.projectId  = body.projectId; }
  if (body.partnerId)       { result.partnerId  = body.partnerId; }
  if (body.clientId)        { result.clientId   = body.clientId; }

  if (params.projectId)     { result.projectId  = params.projectId; }

  callback(null, result);
  return result;
};

_.each(libIds, function(value, key) {
  exports[key] = value;
});

