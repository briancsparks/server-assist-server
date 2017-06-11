
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

lib.upsertApp = function(argv_, context, callback) {
  var argv = sg.deepCopy(argv_);

  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertApp.MongoClient.connect'); }

    var appsDb = db.collection('apps');

    var appId  = argvGet(argv, 'app-id,app');
    var item   = { $set: {appId} };

    _.each(argv, (value, key) => {
      sg.setOnn(item, ['$set', sg.toCamelCase(key)], value);
    });

    everbose(2, `Upserting app: ${appId}`);
    return appsDb.updateOne({appId}, item, {upsert:true}, function(err, result) {
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



