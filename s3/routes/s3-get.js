
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
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const configuration           = serverassist.configuration;
const _200                    = serverassist._200;
const _400                    = serverassist._400;
const _404                    = serverassist._404;
const _500                    = serverassist._500;

const appName                 = 's3';
const projectId               = 'sa';
const appId                   = `${projectId}_${appName}`;
const mount                   = `*/api/v1/${appName}/`;

const appRecord = {
  projectId,
  mount,
  appId,
  route               : `*/api/v:version/${appName}/`,
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

  var s3 = new AWS.S3();

  //-------------------------------------------------------------------------------------------------
  /**
   *  Handles xyz
   *
   *    /xyz
   *
   */
  const s3get = function(req, res, params_, splats, query) {
    var   result      = {};
    const args        = serverassist.normalizeBody(req.bodyJson || {}, params_ || {}, query || {});

    const Bucket      = argvExtract(args, 'bucket');
    const Key         = argvExtract(args, 'key');

    if (!Bucket)      { return _400(req, res, 'Must provide Bucket'); }
    if (!Key)         { return _400(req, res, 'Must provide Key'); }

    return sg.__run2({}, callback, [function(result, next, last, abort) {

      const params = sg.reduce(args, {Bucket, Key}, (m, value, key) => {
        return sg.kv(m, key, value);
      });

      return s3.getObject(params, (err, data) => {
        console.log(err, _.keys(data));

        if (data.ContentType === 'application/json') {
          data.Body = sg.safeJSONParse(data.Body) || data.Body;
        }

        _.extend(result, _.pick(data, 'Body,ETag,ContentType'.split(',')));

        return next();
      });

    }], function last(err, result) {
      return _200(req, res, result);
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
      if (err) { return sg.die(err, callback, `sa_${appName}.addRoutes.configuration`); }

      r = r_;

      _.each(r.result.app_prj, (app_prj, app_prjName) => {
        if (app_prj.app.appId !== appId) { return; }    /* this is not my app */
        //console.log(`my app: ${app_prjName}`, sg.inspect(app_prj));
      });

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

      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get`,       s3get, app_prjName);
      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/*`,     s3get, app_prjName);

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


