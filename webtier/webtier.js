
const sg           = require('sgsg');
const _            = sg._;
const http         = require('http');

var   ARGV         = sg.ARGV();

const hostname     = '127.0.0.1';
const port         = 8210;
const port2        = 8212;

var dumpReq;

const server = http.createServer((req, res) => {
  return sg.getBody(req, function() {
    dumpReq(req, res);

    var fwd   = _.rest(req.url.split('/')).join('/');
    var host  = '127.0.0.1';
    var redir = `/rpxi/${req.method}/${host}:${port2}/${fwd}`;

    console.error(`${req.method}: ${fwd} ->> ${host}:${port2}`);

    res.statusCode = 200;
    res.setHeader('X-Accel-Redirect', redir);
    res.end('');
  });
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

dumpReq = function(req, res) {
  if (sg.verbosity() >= 0) {
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('--------');
  }
};

