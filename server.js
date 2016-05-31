"use strict";

// This is the glue.

let express = require("express");
let http = require("http");
let fs = require("fs");
let bodyParser = require("body-parser");
let mongoose = require("mongoose"); // MongoDB ODM
let session = require("express-session");
let MongoStore = require("connect-mongo")(session);
let ObjectId = mongoose.Types.ObjectId; // this is used to cast strings to MongoDB ObjectIds
let multer = require("multer"); // for file uploads

let Promise = require("bluebird");
mongoose.Promise = Promise;

let config; // contains passwords and other sensitive info
if (fs.existsSync("config.json")) {
	config = require("./config.json");
}
else {
	config = {
		"sessionSecret": "secret",
		"dbName": "MorNetwork",
		"host": "test.dev"
		// add the following line to /etc/hosts to make cookies work with subdomains
		// localhost test.dev
		// then navigate to www.test.dev:8080 in browser for testing
	};
	fs.writeFileSync("config.json", JSON.stringify(config, null, "\t"));
	console.log("Generated default config.json");
}
// create express application
let app = express();

// connect to mongodb server
mongoose.connect("mongodb://localhost:27017/" + config.dbName);

let User = require("./models/User.js")(mongoose); // TODO: change this dependency injection
let Team = require("./models/Team.js")(mongoose);
let Subdivision = require("./models/Subdivision.js")(mongoose);

// start server
let port = process.argv[2] || 8080;
let io = require("socket.io").listen(app.listen(port));
console.log("server started on port %s", port);

// define imports for modules
// this has to be a function so that each module has a different imports object
function getImports() {
	return {
		modules: {
			mongoose: mongoose
		},
		models: {
			User: User,
			Team: Team,
			Subdivision: Subdivision
		},
		socketio: io
	};
};

// check for any errors in all requests
app.use(function(err, req, res, next) {
	console.error(err.stack);
	res.status(500).send("Oops, something went wrong!");
});

// middleware to get request body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: true
}));

let sessionMiddleware = session({
	secret: config.sessionSecret,
	saveUninitialized: false,
 	resave: false,
 	cookie: {
		domain: "." + config.host
	},
	store: new MongoStore({ mongooseConnection: mongoose.connection })
});

// can now use session info (cookies) with socket.io requests
io.use(function(socket, next) {
	sessionMiddleware(socket.request, socket.request.res, next);
});
// can now use session info (cookies) with regular requests
app.use(sessionMiddleware);

// load user info from session cookie into req.user object for each request
app.use(Promise.coroutine(function*(req, res, next) {
	if (req.session && req.session.userId) {
		try {

			let user = yield User.findOne({
				_id: req.session.userId
			});

			req.user = user;

			next();

		} catch (err) {
			// TODO: handle more cleanly the case where userId is not found for if the user is deleted or something
			console.error(err);
			res.end("fail");
		}
	} else {
		next();
	}
}));

function requireSubdomain(name) { // TODO: rename this
	return function(req) {
		let host = req.headers.host;
		return host.startsWith(name + ".") || host.startsWith("www." + name + ".");
	};
}
function requireMorteam(req,res,next) {
	let host = req.headers.host;
//	console.log(/^(www\.)?[^\.]+\.[^\.]+$/.test(host));
	if(
	 /^(www\.)?[^\.]+\.[^\.]+$/.test(host)
	 )next();
}

//let requireMorscout = requireSubdomain("scout"); // TODO: rename this
//let morscoutRouter = require("../morscout-server/server.js")(getImports());
//app.use(requireMorscout, morscoutRouter);

app.set("view engine", "ejs");

let morteamRouter = require("../morteam-server-website/server/server.js")(getImports());
app.use(requireMorteam, morteamRouter);

// 404 handled by each application
// TODO: still put a 404 handler here though?
