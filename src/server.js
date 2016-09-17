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
let vh = require("express-vhost");

let Promise = require("bluebird");
mongoose.Promise = Promise;

function getPath(path) {
    return require("path").join(__dirname, path);
}

let config; // contains passwords and other sensitive info
(() => {
    let configPath = getPath("../config.json");
    let defaultConfig = {
        "sessionSecret": "secret",
        "dbName": "MorNetwork",
        "testDbName": "MorNetworkTest",
        "host": "test.localhost",
        "cookieDomain": "",
    };
    if (fs.existsSync(configPath)) {
        config = require(configPath);
        for (let key in defaultConfig) {
            if (!(key in config)) {
                config[key] = defaultConfig[key];
            }
        }
    } else {
        config = defaultConfig;
        console.log("Generated default config.json");
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
})()

// create express application
let app = module.exports = express();

// connect to mongodb server
let dbName = process.env.NODE_ENV === "test" ? config.testDbName : config.dbName;
mongoose.connect("mongodb://localhost:27017/" + dbName, function() {
    if (process.env.NODE_ENV === "test") {
        mongoose.connection.db.dropDatabase();
    }
});

let User = require("./models/User.js");
let Team = require("./models/Team.js");
let Group = require("./models/Group.js");
let NormalGroup = require("./models/NormalGroup.js");
let AllTeamGroup = require("./models/AllTeamGroup.js");
let PositionGroup = require("./models/PositionGroup.js");

let io;
if (process.env.NODE_ENV === "test") {
    io = {
        use: () => {},
        on: () => {},
    };
    app.use(function(req, res, next) {
        req.headers["host"] = config.host;
        next();
    });
} else {
    // start server
    let port = process.argv[2] || 8080;
    io = require("socket.io").listen(app.listen(port));
    console.log("server started on port %s", port);
}

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
            Group: Group,
            NormalGroup: NormalGroup,
            AllTeamGroup: AllTeamGroup,
            PositionGroup: PositionGroup,
        },
        socketio: io,
    };
};

// check for any errors in all requests
// TODO: does this actually do anything?
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
        domain: "." + (config.cookieDomain || config.host),
    },
    store: new MongoStore({
        mongooseConnection: mongoose.connection
    })
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


let morteam = require(getPath("../../morteam-server-website/server/server.js"))(getImports());
vh.register(config.host, morteam);
vh.register("www." + config.host, morteam);

//let morscout = require("../morscout-server/server.js")(getImports());
//vh.register("scout." + config.host, morscout);
//vh.register("www.scout." + config.host, morscout);

//let testModule = require("./testModule/server.js")(getImports());
//vh.register("test." + config.host, testModule);
//vh.register("www.test." + config.host, testModule);

app.use(vh.vhost(app.enabled("trust proxy")));

// 404 handled by each application
// TODO: still put a 404 handler here though?