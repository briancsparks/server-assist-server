
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var MongoClient         = require('mongodb').MongoClient;
var partnerDb           = require('./partner');

var setOnn              = sg.setOnn;
var argvGet             = sg.argvGet;

var dbHost              = process.env.SERVERASSIST_DB_HOSTNAME || 'localhost';
var mongoUrl            = `mongodb://${dbHost}:27017/serverassist`;

var lib = {};

lib.upsertProject = function(argv, context, callback) {
  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertProject.MongoClient.connect'); }

    var projectsDb = db.collection('projects');

    var projectId = argvGet(argv, 'project-id,project');
    var query = {
      projectId
    };

    var item = {};

    sg.setOnn(item, '$set.upstream', argvGet(argv, 'upstream'));

    return projectsDb.updateOne(query, item, {upsert:true}, function(err, result) {
      console.log(err, result.result);

      var partnerId = `HP_${projectId.toUpperCase()}_SERVICE`;
      return partnerDb.upsertPartner({partnerId, projectId}, context, function(err, result) {
        console.log(err, result.result);


        var partnerId = `HP_${projectId.toUpperCase()}_LIBRARY`;
        return partnerDb.upsertPartner({partnerId, projectId}, context, function(err, result) {
          console.log(err, result.result);

          db.close();
          return callback.apply(this, arguments);
        });
      });
    });

  });
};

_.each(lib, function(value, key) {
  exports[key] = value;
});


