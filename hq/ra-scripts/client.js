
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var MongoClient         = require('mongodb').MongoClient;

var setOnn              = sg.setOnn;
var argvGet             = sg.argvGet;

var dbHost              = process.env.SERVERASSIST_DB_HOSTNAME || 'localhost';
var mongoUrl            = `mongodb://${dbHost}:27017/serverassist`;

var lib = {};

lib.upsertClient = function(argv_, context, callback) {
  var argv = sg.deepCopy(argv_);

  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertClient.MongoClient.connect'); }

    var clientsDb = db.collection('clients');

    var clientId = argvExtract(argv, 'client-id,client');
    var item = {};

    _.each(argv, (value, key) => {
      sg.setOnn(item, ['$set', key], value);
    });

    return clientsDb.updateOne({clientId}, item, {upsert:true}, function(err, result) {
      console.log(err, result.result);

      db.close();
      return callback.apply(this, arguments);
    });
  });
};

_.each(lib, function(value, key) {
  exports[key] = value;
});


