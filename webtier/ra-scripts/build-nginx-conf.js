
/**
 *
 */
const sg                  = require('sgsg');
const _                   = sg._;
const ng                  = require('js2a').nginx;
const clusterLib          = require('js-cluster');

const argvGet             = sg.argvGet;
const ServiceList         = clusterLib.ServiceList;

const minutes             = sg.minutes;

const methods             = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];
const myIp                = process.env.SERVERASSIST_MY_IP          || '127.0.0.1';
const utilIp              = process.env.SERVERASSIST_UTIL_HOSTNAME  || 'localhost';
const myColor             = process.env.SERVERASSIST_COLOR          || 'green';
const myStack             = process.env.SERVERASSIST_STACK          || 'test';

var lib = {};

lib.build = function(argv, context, callback) {

  const fqdns_        = argvGet(argv, 'fqdns,fqdn')   || '';
  const color         = argvGet(argv, 'color')        || myColor;
  const stack         = argvGet(argv, 'stack')        || myStack;

  const serviceList   = new ServiceList(['serverassist', color, stack].join('-'), utilIp);

  var fqdns = fqdns_;
  if (_.isString(fqdns)) {
    fqdns = fqdns.split(',');
  }
  fqdns.unshift('localhost');
  fqdns = _.compact(fqdns);

  var webtierRouter;
  return sg.__run([function(next) {

    // Get the stack router
    return serviceList.waitForOneService('webtier_router', myIp, (err, location) => {
      webtierRouter = location;
      serviceList.quit();
      return next();
    });

  }], function() {

    var ngx = new ng.Nginx();
    var theNginx = function(ngx) {
      return [
        ng.comment(`config for ${color} ${stack}, for ${fqdns.join(', ')}`),
        ng.blankLine(),
        ng.singleLine('user', process.env.USER, 'staff'),
        ng.workerProcesses('2'),
        ngx.events(function(ngx) {
          return ng.workerConnections(1024)
        }),

        ngx.http(function(ngx) {
          return [
            ng.include('mime.types'),
            ng.defaultType('application/octet-stream'),
            ngx.block(function(ngx) {
              var servers = [];

              _.each(fqdns, (fqdn) => {
                servers = servers.concat(
                  ngx.server(function(ngx) {
                    return [
                      ng.listen(80),
                      ng.serverName(fqdn),

                      ngx.block(function(ngx) {
                        var locations = [];

                        _.each(methods, (method) => {
                          locations = locations.concat(
                            ng.blankLine(),
                            ngx.location(`~* ^/rpxi/${method}/(.*)`, (ngx) => {
                              return [
                                ng.internal(),
                                ng.proxyConnectTimeout(5000),
                                ng.proxySendTimeout(5000),
                                ng.proxyReadTimeout(5000),
                                ng.sendTimeout(5000),
                                ng.proxyRedirect(false),

                                ng.proxySetHeader('X-Real-IP', '$remote_addr'),
                                ng.proxySetHeader('X-Forwarded-For', '$proxy_add_x_forwarded_for'),
                                ng.proxySetHeader('X-Forwarded-Proto', '$scheme'),
                                ng.proxySetHeader('Host', '$http_host'),
                                ng.proxySetHeader('X-NginX-Proxy', true),
                                ng.proxySetHeader('Connection', ''),

                                ng.proxyHttpVersion('1.1'),
                                ng.proxyMethod(method),
                                ng.set('$other_uri', '$1'),
                                ng.proxyPass(`http://$other_uri`)

                              ]
                            })
                          );
                        });

                        return locations;
                      }),

                      ng.blankLine(),
                      ng.singleLine('try_files maintenance.html $uri $uri/index.html $uri.html @router'),

                      ng.blankLine(),
                      ngx.location('@router', (ngx) => {
                        return [
                          ng.internal(),
                          ng.proxyConnectTimeout(5000),
                          ng.proxySendTimeout(5000),
                          ng.proxyReadTimeout(5000),
                          ng.sendTimeout(5000),
                          ng.proxyRedirect(false),

                          ng.proxySetHeader('X-Real-IP', '$remote_addr'),
                          ng.proxySetHeader('X-Forwarded-For', '$proxy_add_x_forwarded_for'),
                          ng.proxySetHeader('X-Forwarded-Proto', '$scheme'),
                          ng.proxySetHeader('Host', '$http_host'),
                          ng.proxySetHeader('X-NginX-Proxy', true),
                          ng.proxySetHeader('Connection', ''),

                          ng.proxyHttpVersion('1.1'),
                          ng.proxyPass(webtierRouter)
                        ]
                      }),

                      ng.blankLine(),
                      ngx.location('/', (ngx) => {
                        return [
                          ng.proxyConnectTimeout(5000),
                          ng.proxySendTimeout(5000),
                          ng.proxyReadTimeout(5000),
                          ng.sendTimeout(5000),
                          ng.proxyRedirect(false),

                          ng.proxySetHeader('X-Real-IP', '$remote_addr'),
                          ng.proxySetHeader('X-Forwarded-For', '$proxy_add_x_forwarded_for'),
                          ng.proxySetHeader('X-Forwarded-Proto', '$scheme'),
                          ng.proxySetHeader('Host', '$http_host'),
                          ng.proxySetHeader('X-NginX-Proxy', true),
                          ng.proxySetHeader('Connection', ''),

                          ng.proxyHttpVersion('1.1'),
                          ng.proxyPass(webtierRouter)
                        ]
                      })
                    ];
                  })
                );
              });

              return servers;
            }),
            ng.comment(`config for ${color} ${stack}, for ${fqdns.join(', ')}`),
          ];
        })

      ];
    };

    var obj = ngx.json(theNginx);

    // You can manipulate obj before writing
    // blk.block.push(ng.deny('2.3.4.5/32'));

    // Now, get the conf file contents
    var conf = ng.write.root(obj);

    return callback(null, conf);
  });
};

_.each(lib, (value, key) => {
  exports[key] = value;
});

