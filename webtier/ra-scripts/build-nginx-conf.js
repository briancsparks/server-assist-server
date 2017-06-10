
/**
 *
 */
var sg                  = require('sgsg');
var _                   = sg._;
var ng                  = require('js2a').nginx;

var lib = {};

lib.build = function(argv, context, callback) {

  var fqdns = [
    'localhost',
    'xcc.salocal.net',
  ];

  var methods = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];

  var ngx = new ng.Nginx();
  var theNginx = function(ngx) {
    return [
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
                        ng.set('$other_uri', '$1'),
                        ng.proxyPass('http://localhost:8210')

                      ]
                    })
                  ];
                })
              );
            });

            return servers;
          })
        ];
      })

    ];
  };

  var obj = ngx.json(theNginx);

  // You can manipulate obj before writing
  // blk.block.push(ng.deny('2.3.4.5/32'));

  // Now, get the conf file contents
  var conf = ng.write.root(obj);

  //return callback(null, conf);
  process.stdout.write(conf);
  return callback(null, {});
};

_.each(lib, (value, key) => {
  exports[key] = value;
});

