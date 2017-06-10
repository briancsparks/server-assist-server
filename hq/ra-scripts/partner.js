
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var MongoClient         = require('mongodb').MongoClient;
var projectDb           = require('./project');

var setOnn              = sg.setOnn;
var argvGet             = sg.argvGet;

var dbHost              = process.env.SERVERASSIST_DB_HOSTNAME || 'localhost';
var mongoUrl            = `mongodb://${dbHost}:27017/serverassist`;

var lib = {};

/**
 *  Just insert one partner without any intelligence on inserting a project
 */
var upsertOnePartner = function(argv, context, callback) {
  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertPartner.MongoClient.connect'); }

    var partnersDb = db.collection('partners');
    var query = {
      partnerId : argvGet(argv, 'partner-id,partner')
    };

    var item = {};

    setOnn(item, '$set.projectId',    argvGet(argv, 'project-id,project'));
    setOnn(item, '$set.serviceFqdn',  argvGet(argv, 'service-fqdn,service'));

    return partnersDb.updateOne(query, item, {upsert:true}, function(err, result) {
      //console.log(err, result.result);
      console.error(err);
//      console.log('parnerDb.updateOne', err, result.result);
      if (err)  { console.error(err); }

      db.close();
      return callback(err, result.result);
    });
  });
};

lib.upsertPartner = function(argv, context, callback) {
  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertPartner.MongoClient.connect'); }

    var partnersDb = db.collection('partners');

    // If this is not one of the standard partners, do not upsertProject
    var partnerId = argvGet(argv, 'partner-id,partner');
    var projectId = argvGet(argv, 'project-id,project');

    return sg.__run([function(next) {
      if (partnerId.match(/HP_[^_]+_(SERVICE|LIBRARY)/))  { return next(); }

      return projectDb.upsertProject(projectId, next);
    }, function(next) {

      var argv2 = _.extend({}, argv);
      return upsertOnePartner(argv2, context, function(err, result) {
        console.log('upsdertonepartner for upsertPartner', err, result);
        if (err)  { console.error(err); }

        db.close();
        return callback.apply(this, arguments);
      });

    }], function() {
    });
  });
};

_.each(lib, function(value, key) {
  exports[key] = value;
});



