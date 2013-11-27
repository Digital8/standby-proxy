
var https = require('https');
var express = require('express');
var fs = require('fs');
var lazy = require('lazy');
var request = require('request');
var xml2js = require('xml2js');
var jsdom = require('jsdom');
var async = require('async');

var app = express();
app.use(app.router);
app.use(express.errorHandler());

var options = {
  key: fs.readFileSync('key.pem', 'utf8'),
  cert: fs.readFileSync('cert.pem', 'utf8')
}

var jquery = fs.readFileSync('jquery.min.js').toString();



/********************
 *  DRUMMOND LOGIN  *
 ********************/

app.get('/drummond/login', function(req, res) {
  var username = req.query.username || '';
  var password = req.query.password || '';
  var url = 'https://www.drummondgolf.com.au/loginsync.php';

  if(username.length && password.length) {
    res.set('Content-Type', 'application/json');
    request.get(url + '?username=' + username + '&password=' + password).pipe(res);
  }
  else {
    throw('Username and Password Required');
  }
});



/***********************
 *  DRUMMOND SPECIALS  *
 ***********************/

var specials = {};

var getSpecials = function() {
  console.log('Fetching Specials');
  request('https://www.drummondgolf.com.au/standby.php', function (error, response, body) {
    if (!error && response.statusCode == 200) {
      specials.data = body;
      specials.time = (new Date()).getTime();
    }
    else {
      console.log('Failed to get Specials');
    }
  });
}

//prime the cache
getSpecials();

app.get('/drummond/specials', function(req, res) {
  var now = (new Date()).getTime();

  //for optimum performance just send from cache and update the data after
  //just don't try to send any more data since the connection is closed.

  res.set('Content-Type', 'application/json');
  res.send(specials.data);

  if( (specials.time + 10 * 60000) < now ) {
    console.log('Specials Cache too old');
    getSpecials();
  }
});



/*********************
 *  DRUMMOND MEMBER  *
 *********************/

var members = {};

//load the members
console.log('Loading Members');

new lazy(fs.createReadStream('members.tab')).lines.forEach(function(line) {
  var member = line.toString().split(/\t/);
  member[3] = parseInt(member[3]);
  members[member[3]] = {
    "id": member[3].toString(),
    "first_name": member[0],
    "last_name": member[1],
    "email": member[2]
  }

}).on('pipe', function() {
  process.nextTick(function() {
    console.log(Object.keys(members).length + ' Members Loaded');
  });
});

app.get('/drummond/member/:id', function(req, res) {
  res.set('Content-Type', 'application/json');
  if(members[req.params.id]) {
    res.send(members[req.params.id]);
  }
  else {
    console.log('Member not Found');
    res.send('{}');
  }
});



/***********************
 *  GOLF AUS RSS FEED  *
 ***********************/

var rssFeedCache = {};
var rssFeed = {};

var fetchImages = function() {

  var fetchImage = function(item, cb) {
    var url = item['link'][0];
    console.log('Fetching Image for ' + url);

    jsdom.env({
      url: url,
      src: [jquery],
      done: function (errors, window) {
        if(errors) {
          return cb(errors);
        }

        var $ = window.jQuery;
        var image = $(".articlefulldisplay img:first")[0];
        var youtube = $("iframe[src*=youtube]:first");
        var src = 'http://www.golf.org.au/site/_content/advertising/00000850-image.jpg';

        if (image) {
          src = image.src;
        }
        else if (youtube.length) {
          var pieces = youtube.attr('src').split('/');
          src = 'http://i1.ytimg.com/vi/' + pieces[pieces.length - 1] + '/maxresdefault.jpg';
        }

        console.log(src);
        item.image = [src];
        cb(null);
      }
    });

  }

  async.each(rssFeed['data']['rss']['channel'][0]['item'], fetchImage, function(err) {
    if(err) {
      console.log('Error fetching images');
      console.dir(err);
    }
    else {
      console.log('RSS Loaded');
      rssFeedCache = JSON.parse(JSON.stringify(rssFeed));
    }
  });
}

var getFeed = function() {
  console.log('Fetching RSS Feed');
  var parser = new xml2js.Parser();
  request('http://www.golf.org.au/Site/_content/rss/News.xml', function (error, response, body) {
    if (!error && response.statusCode == 200) {
      parser.parseString(body, function (err, result) {
        if(!err) {
          rssFeed.data = result;
          var now = (new Date()).getTime();
          rssFeed.time = now;
          //update the time here to stop multiple requests
          rssFeedCache.time = now;

          fetchImages();
        }
        else {
          console.log('Error parsing RSS');
        }
      });
    }
    else {
      console.log('Failed to get RSS Feed');
    }
  });
}

//prime the cache
getFeed();

app.get('/rssfeed', function(req, res) {
  var now = (new Date).getTime();

  res.set('Content-Type', 'application/json');
  res.send(rssFeedCache.data);

  if( (rssFeedCache.time + 1 * 60000) < now ) {
    console.log('RSS Feed Cache too old');
    getFeed();
  }
});



app.all('*', function(req, res) {
  throw('Not Implemented');
});

var server = https.createServer(options, app);
server.listen(process.argv[2] || 443, function () {
  console.log('Listening on ' + this.address().port);
});
