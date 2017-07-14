
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var serverassist        = sg.include('serverassist') || require('serverassist');
var MongoClient         = require('mongodb').MongoClient;
var partnerDb           = require('./partner');

var ARGV                = sg.ARGV();
var setOnn              = sg.setOnn;
var argvGet             = sg.argvGet;
var verbose             = sg.verbose;

var mongoUrl            = serverassist.dbHost();

var everbose;
var lib = {};

/**
 *  Upsert a project.
 *
 *      --project-id    -- The projectId (required)
 *      --uri-base      -- The project's 'namespace' (fqdn/projectId)
 *      --upstream      -- The project's default upstream.
 *      --uri-test-base
 */
lib.upsertProject = function(argv, context, callback) {
  var result = { updates:[] };

  return MongoClient.connect(mongoUrl, function(err, db) {
    if (err) { return sg.die(err, callback, 'upsertProject.MongoClient.connect'); }

    var projectsDb  = db.collection('projects');
    var projectId   = argvGet(argv, 'project-id,project');

    var item = {};

    sg.setOnn(item, '$set.projectId',     projectId);
    sg.setOnn(item, '$set.upstream',      argvGet(argv, 'upstream'));
    sg.setOnn(item, '$set.uriBase',       argvGet(argv, 'uri-base,base'));
    sg.setOnn(item, '$set.uriTestBase',   argvGet(argv, 'uri-test-base,test-base'));

    everbose(2, `Upserting project ${projectId}`);
    return projectsDb.updateOne({projectId}, item, {upsert:true}, function(err, result_) {
      if (err) { return sg.die(err, callback, 'upsertProject.updateOne'); }

      result.updates.push(result_);

      var partnerId = `HP_${projectId.toUpperCase()}_SERVICE`;
      return partnerDb.upsertPartner({partnerId, projectId}, context, function(err, result_) {
        if (err)  { console.error(err); }

        result.updates.push(result_);

        var partnerId = `HP_${projectId.toUpperCase()}_LIBRARY`;
        return partnerDb.upsertPartner({partnerId, projectId}, context, function(err, result_) {
          if (err)  { console.error(err); }

          result.updates.push(result_);

          db.close();
          return callback(null, result);
        });
      });
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


