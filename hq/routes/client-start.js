
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const clusterLib              = sg.include('js-cluster')   || require('js-cluster');
const urlLib                  = require('url');

var   ARGV                    = sg.ARGV();
const verbose                 = sg.verbose;
const setOn                   = sg.setOn;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const skip                    = sg.skip;
const reason                  = sg.reason;
const normlz                  = sg.normlz;
const isLocalWorkstation      = serverassist.isLocalWorkstation;
const models                  = serverassist.raScripts.models;
const getIds                  = serverassist.raScripts.getIds;
const ClusterService          = clusterLib.Service;

// Forward decl
var getStackService;
var dumpReq;

var lib = {};

lib.addRoutes = function(addRoute, db, callback) {
  var handlers = {}, determine = {}, translate = {}, determiness = {}, translators = {};

  const clientsDb   = db.collection('clients');
  const stacksDb    = db.collection('stacks');
  const onrampsDb   = db.collection('onramps');
  const projectsDb  = db.collection('projects');
  const partnersDb  = db.collection('partners');
  const sessionsDb  = db.collection('sessions');
  const appsDb      = db.collection('apps');

  const isSpecialClient = function(req) {
    const clientId  = deref(req, 'serverassist.ids.clientId');

    if (!clientId)                                                                        { return false; }

    if (clientId === '7B9qPWSIRh2EXElr4IQcLyrV3540klkqpjLpVtRuElSxyzWU5Tct0pNqA7cJDgnJ')  { return true; }    /* brian android */
    if (clientId === '0InOUypKSp9fXKs62y6URhqmey6nYVMBOx5yd5r58ERwWRwOvZOt5m5GoyIEf0Z0')  { return true; }    /* brian android */
    if (clientId === '1czKyQ6BgQh701Xhk8Tgmqb4M5h04JAaocJJGDo6nvXQbyyM2vt4AAg9TKoIyzCS')  { return true; }    /* brian mac */
    if (clientId === 'TD0Gh10ramGuuECpnmNCYquZ4pmKnrR70nYEfhLfV0gQg4OkZSY5RcaGQqpNEAAz')  { return true; }    /* brian mac */

    if (clientId && (clientId.length > 0 && clientId.length <= 8))                        { return true; }
    if (clientId.length < 53 && clientId.startsWith('marioyoshipeach'))                   { return true; }

    return false;
  };

  const debugLog = function(req) {
    //if (!isSpecialClient) { return; }
    return;
    var args      = _.rest(arguments);

    args.unshift('+-+-+-+=======+-+-+-+');
    args.push('+-+-+-+=======+-+-+-+');
    if (isSpecialClient(req)) {
      console.log.apply(console, args);
    }
  };

  const logChangeToUpstream = function(req, from, to, why) {
    if (!isSpecialClient(req)) { return; }

    console.log(`${from} ->> ${to}, ${why}`);
  };

  // Get the projects records from the DB
  return projectsDb.find({active:{$ne:false}}, {_id:0}).toArray((err, projectRecords) => {
    if (err)  { return sg.die(err, callback, 'clientStart-main.find-projects'); }

    // Make a projects list, indexed by projectId
    const projectsById = sg.reduce(projectRecords, {}, (m, project) => {
      return sg.kv(m, project.projectId, project);
    });

    // Get the stack records from the DB
    return stacksDb.find({color:{$exists:false}}, {_id:0}).toArray((err, stackRecords) => {
      if (err)  { return sg.die(err, callback, 'clientStart-main.find-stacks'); }

      var stacks = {};

      _.each(stackRecords, stack => {
        setOnn(stacks, [stack.projectId, stack.stack], stack);
      });

    // Get the apps records from the DB
    return appsDb.find({active:{$ne:false}}, {_id:0}).toArray((err, appRecords) => {
      if (err)  { return sg.die(err, callback, 'clientStart-main.find-apps'); }

      //
      // Make an apps list, indexed by appId
      //
      // For any app that is multi-use ('*' for root of route), also add an app for
      // that projectId_appId.
      //

      const appsById = sg.reduce(appRecords, {}, (m, app) => {

        if (app.mount[0] === '*') {
          _.each(projectsById, (project, projectId) => {
            var app2    = sg.deepCopy(app);
            var app2Id  = [projectId, ...(_.rest(app.appId.split('_')))].join('_');

            app2.projectId  = projectId;
            app2.appId      = app2Id;

            m[app2Id]       = app2;
          });
        }

        return sg.kv(m, app.appId, app);
      });

      // Dump the apps
      //_.each(appsById, (app, appId) => {
      //  console.log(`all appbyid ${app.appId}`, app);
      //});


      return sg.__run(function main() {

        // Make a copy to hold all the projects that we read from the DB. As we pair
        // them up with functions, remove them from the `projects` var, so we know
        // which omes we have taken care of.
        var projects = sg.extend(projectRecords);

        // Loop over the kinds of determiness (deploy style functions) we have available
        _.each(determiness, (fn, fnDeployStyle) => {

          // Loop over the remaining project objects that we read from the DB
          projects = _.filter(projects, project => {

            // If this project matches the current deploy style function, use it.
            if (project.deployStyle === fnDeployStyle) {

              // Call the setup function to create a handler
              if (project.deployArgs) {
                determiness[project.deployStyle].apply(this, project.deployArgs);
              } else {
                determiness[project.deployStyle](project.projectId, 'prod');
              }

              // Return false to exclude this project from the filter (we have already taken
              // care of it.)
              return false;
            }

            // Return true to the filter, in order to keep lookng for a handler.
            return true;
          });
        });

        // ---------- Other deploy styles ----------

        // ...


        // ---------- Default deploy style ----------

        // Remaining projects get the `justX` style
        _.each(projects, project => {
          determiness.justX(project.projectId, 'prod');
        });

        // All projects are onramps
        var projects = sg.extend(projectRecords);
        _.each(projects, project => {
          translators.onramp(project.projectId);
        });

        // Add our handler for the only route we handle here.
        addRoute('/:projectId/api/:version', '/clientStart', handlers.clientStart);
        addRoute('/:projectId',              '/clientStart', handlers.clientStart);
        addRoute('',                         '/clientStart', handlers.clientStart);

        return callback();

      // ---------- The /clientStart, determine, and translate functions ----------
      }, [function(next) {

        /**
         *  Handles clients' initial request (per session) to /clientStart.
         *
         *  This API allows clients to be built in a way that they do not need to care
         *  about which `upstream` server they will eventually work with. The SA client
         *  libraries fetch this URL, and the server informs where to go.
         *
         *  This function also serves up start-time configuration data.
         *
         *  The requestor must provide enough information for us to properly route
         *  them to the appropriate server:
         *
         *    version --   The version of the API that the requestor needs.
         *
         *    - and at least one of -
         *
         *    projectId -- The project that the client is working for.
         *
         *    - or -
         *
         *    partnerId -- The partner that the client was written for (so we can lookup
         *                 the project.
         *
         *  The following information, if provided will be use appropriately:
         *
         *    clientId  --  An identifier that can uniquely identify the device that is
         *                  making the request. This should not include any PII.
         *
         *    sessionId --  An identifier for this session. Note that the only way that
         *                  a client can guarantee uniqueness of the sessionId is to use
         *                  its own clientId as a base.
         *
         *    username --   Special builds (like debug builds) can set the username (usually
         *                  the gmail/email account associated with the device.)
         *
         *    rsvr  --      The client can request which stack they are sent to. Used only
         *                  to send testers to a test stack.
         *
         *    various --    Various information, like Android vs iOS, the GIT-SHA of the build,
         *                  etc.
         */
        handlers.clientStart = function(req, res, params, splats, match) {
          req.serverassist = {};

          /**
           *  Convienence function to handle error conditions.
           *
           *    400: Bad Request
           */
          const badRequest = function(error) {
            console.error('Client error while handling /clientStart', error);
            return serverassist._400(req, res, null, error);
          };

          /**
           *  Convienence function to handle error conditions.
           *
           *    500: Internal Server Error
           */
          const internalError = function(error) {
            console.error('Server error while handling /clientStart', error);
            return serverassist._500(req, res, null, error);
          };

          if (isSpecialClient(req)) {
            dumpReq(req, res);
          }

          // During this request, we will store pertinent information into the DB. These
          // are the operations to be performed.
          var clientOps   = {};
          var sessionOps  = {};

          // Get client-supplied information from the request
          const url       = urlLib.parse(req.url, true);
          const body      = req.bodyJson || req.body;
          const query     = url.query;

          // All of the parameters, irrespective of where they came from
          var all         = sg.extend(body, query, params);
          var now         = new Date();

          // If the client is requesting a particular stack, it will be on this object
          var requestedServer   = all.rsvr;

          // Get various Ids and information from the request object.
          const { partnerId, clientId, version, sessionId, username } = req.serverassist.ids = getIds({body, query, match});
          var   projectId   = req.serverassist.ids.projectId;

          // Ensure we have all required infomation
          if (!projectId && !partnerId)     { return badRequest('Must provide project-id or partner-id'); }
          if (!version)                     { return badRequest('Must provide version'); }

          // Initialize the result
          //
          //  default stack:      production
          //  default telemetry:  client to send telemetry
          //
          var   result = {};
          setOn(result, 'upstream',             'prod');
          setOn(result, 'preference.telemetry', true);

          return sg.__run([function(next) {

            // ----- Get the projectId ----
            //  The project Id does not usually come along with requests -- it us usuall the
            //  partner that is identified, so we will need to get the project config indirectlyl

            if (!partnerId)   { return next(); }

            // Default the partner object, and then get from the DB
            req.serverassist.partner = {};
            return models.findPartner({partnerId}, function(err, partner) {
              if (err || !partner)    { return skip(`No partner ${partnerId} found.`, next); }

              // Update with info retrieved from the DB
              req.serverassist.partner = partner;
              projectId = partner.projectId || projectId;
              req.serverassist.ids.projectId = projectId;
              return next();
            });

          // ----- get project from DB -----
          }, function(next) {
            // If we don't have a projectId by this point in the flow, we will not be able to get it.
            if (!projectId)  { return badRequest(`do not have projectId`); }

            // Default the project object, and then get from the DB
            req.serverassist.project = {};
            return models.findProject({projectId}, function(err, project) {
              if (err || !project)    { return skip(`No project ${projectId} found.`, next); }

              // Update with info retrieved from the DB
              req.serverassist.project = project;
              return next();
            });

          // ----- Did we get a project? -----
          }, function(next) {

            // Make sure we were able to find the associated project object.
            if (!req.serverassist.project)  { return badRequest(`No project`); }

            return next();

          // ----- get client from DB -----
          }, function(next) {

            // Default client -- the empty JS object
            req.serverassist.client = {};

            // The clientId is not strictly necessary
            if (!clientId)  { return skip(`No clientId supplied.`, next); }

            // Read the client object from the DB
            return models.findClient({clientId}, function(err, client) {
              if (err)      { return skip(`No client ${clientId} found.`, next); }
              if (!client)  { return next(); }

              // Update with info retrieved from the DB
              req.serverassist.client = client;
              return next();
            });

          // ----- Build up the default response -----
          }, function(next) {

            // Set the `upstream` server that the client must use. This code notices if the user
            // is getting a default response, or if the client/partner/project objects change it.
            //
            // If the user is just getting the default, but they requested a specific stack, send
            // them to their requested stack, as long as it is one that we know about and approve.
            //
            // Note that at this point, `upstream` is a simple term, like `prod` or `test_next`.
            //

            // Remember the `upstream` before the system potentially changes it.
            const origUpstream = result.upstream;

            // Set the `upstream` from the client/partner/project
            const sa = req.serverassist || {};
            setOn(result, 'upstream',
                        (sa.client  && sa.client.upstream)  ||
                        (sa.partner && sa.partner.upstream) ||
                        (sa.project && sa.project.upstream));

            const dbChanged = !!((sa.client && sa.client.upstream) || (sa.partner && sa.partner.upstream) || (sa.project && sa.project.upstream));

            logChangeToUpstream(req, origUpstream, result.upstream, `initial-DB-objects-change`);

            // Did the system set the upstream? If not, see if the client wants to be sent somewhere
            if (result.upstream === origUpstream /*didnt change*/ || (result.upstream === 'prod' && sg.isnt(origUpstream)) /*was never set*/) {

              // Did the user request a server?
              if (requestedServer && !dbChanged) {
                if      (requestedServer === 'hqdev')       { result.upstream = 'test'; }
                else if (requestedServer ===   'dev')       { result.upstream = 'test'; }
                else if (requestedServer === 'hqqa')        { result.upstream = 'test'; }
                else if (requestedServer ===   'qa')        { result.upstream = 'test'; }
                else if (requestedServer === 'hqqanext')    { result.upstream = 'test_next'; }
                else if (requestedServer ===   'qanext')    { result.upstream = 'test_next'; }
                else if (requestedServer === 'hqstg')       { result.upstream = 'staging'; }
                else if (requestedServer ===   'stg')       { result.upstream = 'staging'; }
                else if (requestedServer === 'hqprod')      { result.upstream = 'prod'; }
                else if (requestedServer ===   'prod')      { result.upstream = 'prod'; }
                else {
                  console.error(`Unknown rsvr=${requestedServer}; shoule be hqqa, hqdev, hqprod, etc.`);
                }

                if (result.upstream !== origUpstream) {
                  logChangeToUpstream(req, origUpstream, result.upstream, `rsvr-client-request`);
                }
              }
            }


            // Pass all startup preferences to the client
            setOn(result, 'preference',
                sg.extend((result     && result.preference) || {},
                          (sa.project && sa.project.preference) || {},
                          (sa.partner && sa.partner.preference) || {},
                          (sa.client  && sa.client.preference)  || {}));

            return next();

          }, function(next) {

            // Next, we update the DB with any info that was pertinent. We update the client
            // object first, so that we can know how many timee the user has been here.

            // Remember the client record from the DB, for use adding the session
            var clientRecord;

            return sg.__run([function(next) {

              // ----- update the client object -----

              if (!clientId) { return skip('No clientId to add/update in DB', next); }

              setOn(clientOps, '$set.clientId', clientId);      // The Id
              setOn(clientOps, '$setOnInsert.ctime', now);      // ctime
              setOn(clientOps, '$set.mtime', now);              // mtime
              setOn(clientOps, '$inc.visits', 1);               // Number of visits
              setOn(clientOps, '$set.username', username);      // The user's username

              // Update the client object in the DB, returning the new object, so we have an accurate numer of visits.
              return clientsDb.findOneAndUpdate({clientId}, clientOps, {upsert:true, returnOriginal:false}, function(err, r) {
                if (err)              { return skip("Updating client "+clientId+" failed... continuing."); }
                if (!r.ok)            { return skip("DB update failed for "+clientId+"... continuing."); }

                // Store the client DB-record
                clientRecord = r.value;
                return next();
              });

              return next();

            }, function(next) {

              // ----- likewise, update the session object -----

              if (!sessionId) { return skip('No sessionId to add/update in DB', next); }

              setOn(sessionOps, '$set.sessionId', sessionId);     // The Id
              setOn(sessionOps, '$setOnInsert.ctime', now);       // ctime
              setOn(sessionOps, '$set.mtime', now);               // mtime
              setOn(sessionOps, '$set.clientId', clientId);       // The associated clientId

              // Record if this is a first-time visit, or a return user
              if (clientRecord && _.isNumber(clientRecord.visits)) {
                setOn(sessionOps, '$set.visitNum', clientRecord.visits);
                if (clientRecord.visits === 1) {
                  setOn(sessionOps, '$set.firstVisit', true);
                } else {
                  setOn(sessionOps, '$set.returnVisit', true);
                }
              }

              // Store the session DB-record
              return sessionsDb.updateOne({sessionId}, sessionOps, {upsert:true}, function(err, r) {
                if (err)  { return skip("Inserting session "+sessionId+" failed... continuing."); }

                return next();
              });

              return next();
            }], function() {
              return next();
            });

            return next();

          // ----- Find and call the determine function -----

          // We finally know which stack is desired like `prod` or `test`. Now, we must find the
          // FQDN of the stack for it. The `determine` function takes into account:
          //
          //  1) The stack that the user was desired to go to.
          //  2) Which stacks are acting as the current incarnation of the stack.
          //  3) The current running-state of the various stacks within the system, and
          //  4) Which stacks act as fallbacks for which other stacks.
          //
          //  * -- The requestor will always get `prod` at the very least.
          //

          }, function(next) {

            var determine_;
            if (!projectId)                                               { return badRequest(`do not have projectId`); }

            determine_ = deref(determine, [projectId, version]) || deref(determine, projectId);

            if (!determine_)                                              { return badRequest(`do not have determine fn for ${projectId}.${version}`); }

            return determine_(req, res, match, result, function(err) {
              if (err)  { return internalError(err); }
              return next();
            });

          // ----- Find and call the translate function -----

          // Now that we know which of *our* stacks will handle the session, we must
          // consider that -- from the client's point of view -- they might need to
          // make a request of a totally different server. For example, this is what
          // happens when Secure Print uses Apigee.
          //

          }, function(next) {

            var translate_;
            if (!projectId)                                               { return badRequest(`do not have projectId`); }

            translate_ = deref(translate, [projectId, version]) || deref(translate, projectId);

            if (!translate_)                                              { return badRequest(`do not have translate fn for ${projectId}.${version}`); }

            return translate_(req, res, match, result, function(err) {
              if (err)  { return internalError(err); }
              return next();
            });


          // We have an fqdn where the client should go, but we need to hand out
          // uriBase-style info.
          //

          }, function(next) {

            const upstream      = result.fqdn;
            //const projectIds    = _.compact([req.serverassist.ids.baseProjectId, req.serverassist.ids.projectId]);
            const projectIds    = _.compact([req.serverassist.ids.projectId]);

            _.each(appsById, app => {
              if (projectIds.indexOf(app.projectId) === -1)   { return; }
              if (app.subdomain)                              { return; }
              if (app.requireClientCerts)                     { return; }   // TODO: determine if they sent a client cert with this request

              // Fixup props
              if (sg.isnt(app.useHttp))               { app.useHttp             = !app.isAdminApp; }
              if (sg.isnt(app.useHttps))              { app.useHttps            = app.isAdminApp; }
              if (sg.isnt(app.requireClientCerts))    { app.requireClientCerts  = false; }

              const project       = projectsById[app.projectId] || {};
              const projectPath   = _.rest(_.compact((project.uriBase || '').split('/')));
              const protocol      = app.useHttps? 'https' : 'http';

              var appPath         = _.compact(app.mount.split('/'));
              if (_.last(projectPath) === _.first(appPath) || _.first(appPath) === '*') {
                appPath.shift();
              }

              appPath = [...projectPath, ...appPath].join('/');

              const appName = _.rest(app.appId.split('_')).join('_');

              setOn(result, ['upstreams', appName], protocol+'://'+normlz(`${upstream}/${appPath}`));
            });

            return next();
          }], function() {

            // Success!
            if (isSpecialClient(req)) {
              console.log(`/clientStart result:`, sg.inspect(result));
            }

            return sg._200(req, res, result);

          });
        };

        //
        // stackAlias_ and stackAlias() translate the easy stack names like `prod` into an
        // object that can be used to query the MongoDB for a stack record.
        //

        var stackAlias_ = {
          prod    : {stack: 'pub',    state: 'main'},
          staging : {stack: 'pub',    state: 'next',   fallback: 'prod'},
          qa      : {stack: 'test',   state: 'main'},
          test    : {stack: 'test',   state: 'main'}
        };

        var stackAlias = function(stack) {
          const parts = stack.split('_');
          if (parts.length === 1) {
            return _.pick(stackAlias_[stack] || stackAlias_.prod, 'stack', 'state');
          }

          /* otherwise */
          if (parts.length === 2) {
            return {stack: parts[0], state: parts[1]};
          }

          /* otherwise */
          return _.pick(stackAlias_.prod, 'stack', 'state');
        };

        /**
         *  If the desired stack is not available, this function can be used to determine
         *  an alternative.
         */
        const stackFallback = function(stack) {
          const parts = stack.split('_');
          if (parts.length === 1) {
            return stackAlias_[stack] && stackAlias_[stack].fallback;
          }

          /* otherwise */
          if (parts[1] !== 'next') { return null; }

          /* otherwise */
          return [parts[0], 'main'].join('_');
        };

        /**
         *  Finds the stack for a project/upstream combo.
         *
         *  Knows that projects might have a `base` attr, which should be
         *  tried as a backup.
         */
        const findStack = function(req, upstream, projectId, attempt, callback) {
          var query = stackAlias(upstream || 'prod');

          sg.setOnn(query, 'projectId', projectId);

          var stack;
          return sg.__run([function(next) {

            return stacksDb.find(query).toArray(function(err, stacks) {
              if (sg.ok(err, stacks)) { stack = stacks[0]; }

              verbose(3, `findStack: ${upstream} projectId: ${query.projectId}`, query, err, stacks);
              return next();
            });

          }, function(next) {

            if (stack)        { return next(); }    /* already have it */
            if (!projectId)   { return next(); }    /* no use trying further, dont have project */

            // We did not find the stack above. Try any base project
            return projectsDb.find({projectId}).toArray(function(err, projects) {
              if (!sg.ok(err, projects))    { return next(); }
              if (projects.length < 1)      { return next(); }
              if (!projects[0].base)        { return next(); }

              sg.setOnn(query, 'projectId', projects[0].base);
              return stacksDb.find(query).toArray(function(err, stacks) {
                if (sg.ok(err, stacks)) { stack = stacks[0]; }

                verbose(3, `findStack: ${upstream} projectId: ${query.projectId}`, query, err, stacks);

                // We found the stack by using the projects base project
                setOnn(req, 'serverassist.ids.baseProjectId', query.projectId);
                return next();
              });
            });

          }], function() {
            if (!stack && attempt) {
              console.log(`Failed to find stack from DB on ${attempt} attempt`, sg.inspect(query));
              return callback();
            }

            return callback(null, stack);
          });
        };

        /**
         *  Determine if your desired stack has a running service.
         *
         *  If not, the callback will be called with `undefined` or `null` as
         *  the service.
         */
        const getServiceFromUpstream = function(req, upstream, projectId, serviceName, attempt, callback) {

          return findStack(req, upstream, projectId, attempt, (err, stack) => {
            if (!sg.ok(err, stack)) { return callback(err); }

            return getStackService(stack.color, stack.stack, serviceName, callback);
          });
        };

        /**
         *  Knows that the app has 'main' and 'next' style apps
         *
         *  A `determine` function that knows about the green/blue deploy projects. It
         *  implements the behavior described above (handles the (4) things.()
         */
        determiness.greenBlueByService = function(projectName, serviceName_) {
          const serviceName = serviceName_ || projectName;

          console.log(`clientStart-determiness-greenBlueByService ${projectName} ${serviceName}`)
          determine[projectName] = function(req, res, match, result, callback) {
            var clientId = deref(req, 'serverassist.ids.clientId') || 'nobody';

            return sg.__run([function(next) {

              // See if the upstream stack is up and running
              return getServiceFromUpstream(req, result.upstream, req.serverassist.ids.projectId, serviceName, 'first', function(err, service) {
                debugLog(req, `upstream: ${result.upstream} for ${clientId}, project: ${req.serverassist.ids.projectId}:${serviceName}: service:`, err, service);

                if (err)                                     { return callback(err); }
                if (!service || !_.isArray(service))         { return next(); }    // Try the next option
                if (service.length < 1)                      { return next(); }    // Try the next option

                // Yes, it is up and running, use it.
                return callback(null, result);
              });

            }, function(next) {

              // No, the stack that we wanted is not up. Look for a fallback.
              const fallback  = stackFallback(result.upstream);
              if (!fallback) {
                debugLog(req, `no fallback upstream: ${result.upstream}`);
                return next();
              }

              // We found a fallback -- now we must determine if it is up and running, just like above.
              logChangeToUpstream(req, result.upstream, fallback, `greenBlue-determine-fallback1`);
              result.upstream = fallback;
              return getServiceFromUpstream(req, result.upstream, req.serverassist.projectId, serviceName, 'last', function(err, service) {
                debugLog(req, `fallback upstream: ${result.upstream} for ${clientId}, project: ${req.serverassist.ids.projectId}:${serviceName}: service:`, err, service);

                if (err)                                     { return callback(err); }
                if (!service || !_.isArray(service))         { return next(); }    // Try the next option
                if (service.length < 1)                      { return next(); }    // Try the next option

                // Yes, it is up and running. Use it.
                return callback(null, result);
              });

            }], function() {

              // Did not find it running. Just use prod
              logChangeToUpstream(req, result.upstream, 'prod', `greenBlue-determine-finally-give-up`);
              result.upstream = 'prod';
              debugLog(req, `settling for upstream: ${result.upstream}`);
              return callback(null, result);
            });
          };
        };

        /**
         *  The defult `determine` behavior -- just sends the client to
         *  a hard-coded stack.
         */
        determiness.justX = function(projectName, stack) {
          console.log(`clientStart-determiness-justX ${projectName} ${stack}`)

          determine[projectName] = function(req, res, match, result, callback) {
            const clientId  = deref(req, 'serverassist.ids.clientId') || 'nobody';

            // Send them to the stack from the DB
            logChangeToUpstream(req, result.upstream, stack, `justX`);
            result.upstream = stack;

            debugLog(req, `upstream: ${result.upstream} for ${clientId}, project: ${req.serverassist.ids.projectId}`);
            return callback(null, result);
          };
        };

        //
        // Translate functions take a specific stack of ours and translate that name
        // into an FQDN that a client can use.
        //

        /**
         *  Translates simple names (like 'prod') into fqdn for project.
         *
         *  This is a simple DB lookup -- the stack records in the DB know their FQDN. However
         *  this is an FQDN that might be cryptic and specific to us.
         *
         *  * Knows that projects might have a base project
         *  * Uses the system-fallback project (sa), if the DB does not have an entry for the requested project
         */
        translate.simple = function(req, res, match, result, callback, fallbackProjectId) {
          const requestedStack  = result.upstream || 'prod';
          const stackName       = result.upstream === 'prod' ? 'pub' : result.upstream;
          const projectId       = deref(req, 'serverassist.ids.projectId');
          const baseProjectId   = deref(req, 'serverassist.ids.baseProjectId');
          const stack_          = deref(stacks, [baseProjectId || projectId, stackName]) || deref(stacks, [fallbackProjectId, stackName]) || {};
          const protocol        = stack_.useHttp ? 'http' : 'https';

          return findStack(req, requestedStack, fallbackProjectId || projectId, null, function(err, stack) {
            if (err)  { return callback(err); }

            if (!stack) {

              // If the requested project is not up, use sa
              if ((fallbackProjectId || projectId) !== 'sa') {
                logChangeToUpstream(req, result.upstream, `${result.upstream}-sa`, `simpleTranslate-nostack-goto-sa`);
                return translate.simple(req, res, match, result, callback, 'sa');
              }

              // If they did not request prod, but what they requested is not up, switch to prod
              if (requestedStack !== 'prod') {
                logChangeToUpstream(req, result.upstream, 'prod', `simpleTranslate-nostack-goto-prod`);
                result.upstream = 'prod';
                return translate.simple(req, res, match, result, callback);
              }

              return callback('ENO_STACK');
            }

            const newUpstream = `${protocol}://${stack.fqdn}/${projectId || fallbackProjectId}`;
            logChangeToUpstream(req, result.upstream, newUpstream, `simpleTranslate-found-in-DB`);

            result.upstream   = newUpstream;
            result.fqdn       = stack.fqdn;
            result.protocol   = protocol;

            return callback(null);
          });
        };

        /**
         *  Translates a simple server name like `prod` into an FQDN that the client will
         *  use. For example, `prod` might currently be implemented by the `blue-pub.xyz.net`
         *  hosts. The `simple` function, above, will make this translation for us.
         *
         *  This `onramp` function will then translate the internal-ish name into an
         *  external name.
         */
        translators.onramp = function(projectName) {
          console.log(`clientStart-translators-onramp ${projectName}`)

          setOn(translate, projectName, function(req, res, match, result, callback) {

            // Call the `simple` function to get our internal name
            return translate.simple(req, res, match, result, function(err) {
              if (err)    { return callback(err); }

              const clientId  = deref(req, 'serverassist.ids.clientId') || 'nobody';

              var   query = {
                internalName  : result.fqdn || result.upstream,
                projectId     : projectName
              };

              // Look up the internal name in the DB to get the external name.
              return onrampsDb.find(query).limit(1).next(function(err, onramp) {
                if (err)    { console.error(err); return callback(err); }

                debugLog(req, `translate(onramp): ${result.upstream} for ${clientId}, project: ${req.serverassist.ids.projectId} ->> ${onramp && onramp.externalName}`);

                if (onramp) {
                  const newUpstream = `${result.protocol}://${onramp.fqdn}/${projectName}`;
                  logChangeToUpstream(req, result.upstream, newUpstream, `onramp`);

                  result.upstream = newUpstream;
                  result.fqdn     = onramp.fqdn;
                }
                return callback(err, onramp);
              });
            });
          });
        };

        /**
         *  Translate into an Apigee-specific endpoint.
         *
         *  NOTE: This function is half-baked, as I realized that the `onramp` function
         *  could do everything we needed for our then-current usage of Apigee. However,
         *  in the future, our usage of Apigee may require a callout to them for example.
         */
        translators.apigee = function(projectName, version, apiName) {
          translate[projectName] = translate[projectName] || {};
          translate[projectName][version] = function(req, res, match, result, callback) {

            // Get FQDN
            return translate.simple(req, res, match, result, function(err) {
              if (err) { return callback(err); }

              // result.upstream should be fqdn of ours (color-stack.domainname.net)
              var color, stack, domain, tld;
              const m = result.upstream.match(/([^-]+)-([^.]+)\.([^.]+)\.(.*)$/);
              if (m) {
                color   = m[1];
                stack   = m[2]+'.';
                domain  = m[3];
                tld     = m[4];

                if (stack === 'pub.') {
                  stack = '';
                }

                result.upstream = `https://${stack}${apiName}.api.hp.com/${projectName}/${color}/api/${version}`;
              }

              return callback(null);
            });
          };
        };


        return next();
      }]);
    });
    });
  });
};

/**
 *  Functions to determine what services are running within the cluster.
 */
var servicesForAllStacks = {};
const getServicesForStack = function(color, stack) {
  servicesForAllStacks[color]         = servicesForAllStacks[color]         || {};
  servicesForAllStacks[color][stack]  = servicesForAllStacks[color][stack]  || new ClusterService([process.env.NAMESPACE || 'mario', color, stack].join('-'), process.env.SERVERASSIST_UTIL_IP);

  return servicesForAllStacks[color][stack];
};

getStackService = function(color, stack, name, callback) {
  const clusterService = getServicesForStack(color, stack);
  return clusterService.getServiceLocation(name, function(err, service) {
    if (err)  { return callback(err); }

    // Found the service
    return callback(null, service);
  });
};

dumpReq = function(req, res) {
  if (sg.verbosity() >= 3) {
    console.log('-------------------------------------------------------');
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('-------------------------------------------------------');
  }
};

_.each(lib, (v,k) => {
  exports[k] = v;
});



