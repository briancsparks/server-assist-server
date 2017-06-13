
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var MongoClient         = require('mongodb').MongoClient;

var ARGV                = sg.ARGV();
var setOnn              = sg.setOnn;
var argvGet             = sg.argvGet;
var verbose             = sg.verbose;

var dbHost              = process.env.SERVERASSIST_DB_HOSTNAME || 'localhost';
var mongoUrl            = `mongodb://${dbHost}:27017/serverassist`;

var everbose;
var lib = {};

lib.upsertClient = function(argv_, context, callback) {
  var argv = sg.deepCopy(argv_);

  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertClient.MongoClient.connect'); }

    var clientsDb = db.collection('clients');
    var clientId = argvGet(argv, 'client-id,client');
    var item = {};

    _.each(argv, (value, key) => {
      sg.setOnn(item, ['$set', sg.toCamelCase(key)], sg.smartValue(value));
    });

    everbose(2, `Upserting client ${clientId}`);
    return clientsDb.updateOne({clientId}, item, {upsert:true}, function(err, result) {
      console.log(err, result.result);

      db.close();
      return callback.apply(this, arguments);
    });
  });
};

everbose = function(level) {
  if (level >= sg.verbosity()) {
    _.each(_.rest(arguments), function(arg) {
      console.error(sg.inspect(arg));
    });
  }
};

_.each(lib, function(value, key) {
  exports[key] = value;
});


