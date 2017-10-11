
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const fs                      = sg.extlibs.fsExtra;
const path                    = require('path');
const AWS                     = require('aws-sdk');

const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const safeNewRegExp           = sg.safeNewRegExp            || mySafeNewRegExp;
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const configuration           = serverassist.configuration;
const _200                    = serverassist._200;
const _400                    = serverassist._400;
const _403                    = serverassist._403;
const _404                    = serverassist._404;
const _500                    = serverassist._500;

const myAppName               = 's3';
const projectId               = 'sa';
const appId                   = `${projectId}_${myAppName}`;
const mount                   = `*/api/v1/${myAppName}/`;

const appRecord = {
  projectId,
  mount,
  appId,
  route               : `*/api/v:version/${myAppName}/`,
  isAdminApp          : false,
  useHttp             : true,
  useHttps            : true,
  requireClientCerts  : false
};


var lib = {};

lib.addRoutes = function(addRoute, onStart, db /*, addRawRoute, callback */) {
  var   args          = _.rest(arguments, 3);
  const callback      = args.pop();
  const addRawRoute   = args.shift();
  var   r;

  var   access        = {};

  var s3 = new AWS.S3();

  //-------------------------------------------------------------------------------------------------
  /**
   *  Handles s3get
   *
   *    /s3get
   *
   */
  const s3get = function(req, res, params_, splats, query) {
    var   result      = {};
    const args_       = sg.extend(req.bodyJson || {}, params_ || {}, query || {});
    const projectId   = argvGet(args_, 'project-id,projectId');
    const args        = _.omit(args_, 'projectId,version'.split(','));

    const start       = _.now();
    const Bucket      = argvExtract(args, 'bucket');
    const Key         = argvExtract(args, 'key');
    const delay       = argvExtract(args, 'delay');

    if (!Bucket)      { return _400(req, res, 'Must provide Bucket'); }
    if (!Key)         { return _400(req, res, 'Must provide Key'); }

    const allowRules  = deref(access, [projectId+'_'+myAppName, 'allow']) || [];
    const allow       = sg.reduce(allowRules, null, (m, rule) => {
      if (Bucket.match(rule.bucket) && Key.match(rule.key)) { return true; }
      return m;
    }) || false;

console.log({allow});

    if (!allow)       { return _403(req, res, `Access denied to ${Bucket}/${Key}`); }

    return sg.__run2({}, [function(result, next, last, abort) {

      const params = sg.reduce(args, {Bucket, Key}, (m, value, key) => {
        return sg.kv(m, key, value);
      });

      return s3.getObject(params, (err, data) => {
        if (err) {
          console.log(_.pick(err, 'message,code,statusCode'.split(',')));
          if (err.statusCode === 404)   { return _404(req, res, err.code || 'Not Found'); }
          return _400(req, res, err);
        }

        //console.log(err, _.keys(data), _.omit(data, 'Body'), data.Body.length, typeof data.Body);

        // If its JSON, return as such
        if (data.ContentType === 'application/json') {
          _.extend(result, sg.safeJSONParse(data.Body) || data.Body);
          return next();
        }

        /* otherwise -- return according to the metadata that S3 has */
        if (sg.isnt(delay)) {
          return doit();
        }

        /* othewise */
        const elapsed = _.now() - start;
        return sg.setTimeout(delay - elapsed, doit);

        function doit() {
          res.writeHead(200, {
            'Content-Type'    : data.ContentType,
            'Content-Length'  : data.ContentLength
          });
          res.end(data.Body);
        }

      });

    }], function last(err, result) {
      if (sg.isnt(delay)) {
        return doit();
      }

      /* othewise */
      const elapsed = _.now() - start;
      return sg.setTimeout(delay - elapsed, doit);

      function doit() {
        return _200(req, res, result);
      }
    }, function abort(err, msg) {
      if (msg)  { return _404(req, res, msg); }
      return _400(err);
    });

  };
  //-------------------------------------------------------------------------------------------------


  // ------------------------------------------------------------------------------------------------
  //
  //  Run the startup logic (set things up for the above handlers.)
  //

  return sg.__run([function(next) {
    return registerAsServiceApp(appId, mount, appRecord, next);

  }, function(next) {
    return configuration({}, {}, (err, r_) => {
      if (err) { return sg.die(err, callback, `sa_${myAppName}.addRoutes.configuration`); }

      r = r_;

      // Determine the access rules to buckets and keys
      _.each(r.db.appprjRecords, appprjRecord => {
        if (appprjRecord.appId !== myAppName) { return; }
        const allow = _.map(appprjRecord.allow, rule => {
          return {bucket:safeNewRegExp('^'+rule.bucket+'$'), key:safeNewRegExp('^'+rule.key)};
        });
        access[appprjRecord.appProjectId] = {allow};
      });

      //_.each(r.result.app_prj, (app_prj, app_prjName) => {
      //  if (app_prj.app.appId !== appId) { return; }    /* this is not my app */
      //});

      return next();
    });

  }, function(next) {

    //
    //  Add routes for the public APIs
    //

    console.log(`  -- s3 public routes:`);
    _.each(r.result.app_prj, (app_prj, app_prjName) => {

      if (app_prj.app.appId !== appId) { return; }    /* this is not my app */

      const [projectId, appName]  = app_prjName.split('_');
      const myMount               = deref(app_prj, [myStack, myColor, 'mount']) || '';

      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get`,                  s3get, app_prjName, true);
      //addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/:Bucket/:Key`,     s3get, app_prjName, true);      // Does not work right, yet
      //addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/:Bucket/:Key/*`,   s3get, app_prjName, true);      // Does not work right, yet
      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/*`,                s3get, app_prjName, true);

      // Add startup notification handler for S3
      onStart.push(function(port, myIp) {
        const myServiceLocation   = `http://${myIp}:${port}`;

        console.log(`${sg.pad(app_prjName, 35)} [${myServiceLocation}] (for /${myMount})`);
        registerMyService();

        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(app_prjName, myServiceLocation, myIp, 4000);
        }
      });
    });

    return next();

  }], function() {
    return callback();
  });

};

_.each(lib, (value, key) => {
  exports[key] = value;
});

function mySafeNewRegExp(str) {
  try {
    return new RegExp(str);
  } catch(e) {
  }

  return /*undefined*/;
}


