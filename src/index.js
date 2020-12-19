const mqtt = require("mqtt");

const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const enableGracefulShutdown = require('server-graceful-shutdown');

const debug = process.env.EKOS_WEB_DEBUG === "1";
const brokerURL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1";

const mqttClient = mqtt.connect(brokerURL);

const server = http.createServer();

// These three listen for messages from Ekos.
const messageServer = new WebSocket.Server({ noServer: true });
const mediaServer = new WebSocket.Server({ noServer: true });
const cloudServer = new WebSocket.Server({ noServer: true });

// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
  'SIGHUP': 1,
  'SIGINT': 2,
  'SIGTERM': 15
};

// Do any necessary shutdown logic for our application here
const shutdown = (signal, value) => {
  console.log("shutdown!");

  mqttClient.end();
  messageServer.close();
  mediaServer.close();
  cloudServer.close();

  server.shutdown(() => {
    console.log(`server stopped by ${signal} with value ${value}`);
    process.exit(128 + value);
  });
};

// Create a listener for each of the signals that we want to handle
Object.keys(signals).forEach((signal) => {
  process.on(signal, () => {
    console.log(`process received a ${signal} signal`);
    shutdown(signal, signals[signal]);
  });
});

const sendMsg = (channel, msg) => {
  const topic = `ekos/${channel}/${msg.type}`;

  if (debug) {
    console.log([topic, msg]);
  }

  mqttClient.publish(topic, JSON.stringify(msg));
}

messageServer.on("connection", (ws) => {
  ws.on("message", (msg) => {
    // Forward all messages to mqtt.
    const msgObj = JSON.parse(msg);
    sendMsg("message", msgObj);
  });

  ws.on("close", () => {
    sendMsg("message", { type: "new_connection_state", payload: { connected: false, online: false } });
  });
});

mediaServer.on("connection", (ws) => {
  ws.on("message", (msg) => {
    // The media connection either sends a JSON string or a binary blob.
    // The JSON string is image metadata, the blob is the jpeg image itself.
    // Let's turn those into well formed packets that match our other packet's
    // structure.

    const metaEnd = msg.indexOf('}');

    let msgObj = { type: "image_data", payload: JSON.parse(Buffer.from(msg.subarray(0, metaEnd + 1))) };

    let imgStart = msg.indexOf(0xff, metaEnd + 1);

    const raw = Buffer.from(msg.subarray(imgStart));

    const encoded = raw.toString('base64');

    msgObj.payload['image'] = "data:image/jpeg;base64," + encoded;

    sendMsg("media", msgObj);
  });
});

cloudServer.on("connection", (ws) => {
  // In offline mode, Ekos won't send any data here, but will still try to
  // connect to the web socket.
  // In online mode, it will send the full compressed FITS files.
  ws.on("message", (msg) => {
    sendMsg("cloud", msgObj);
  });
});

server.addListener("request", (req, res) => {
  console.log('request started', req.url);

  switch (req.url) {
    // Ekos will send a call to this route on initial connection. It must
    // return a 200 response with a token and success == true for Ekos to
    // set up the web socket connections.
    case "/api/authenticate": {
      res.writeHead(200);
      res.end(JSON.stringify({
        "token": "TOKEN",
        "success": true,
      }));
      break;
    }
  }
})

server.on("upgrade", (req, socket, head) => {
  console.log('upgrade started', req.url);

  const pathname = url.parse(req.url).pathname;

  switch (pathname) {
    case "/message/ekos": {
      messageServer.handleUpgrade(req, socket, head, (ws) => {
        messageServer.emit("connection", ws, req);
      });
      break;
    }
    case "/media/ekos": {
      mediaServer.handleUpgrade(req, socket, head, (ws) => {
        mediaServer.emit("connection", ws, req);
      });
      break;
    }
    case "/cloud/ekos": {
      cloudServer.handleUpgrade(req, socket, head, (ws) => {
        cloudServer.emit("connection", ws, req);
      });
      break;
    }
    default:
      socket.destroy();
  }
});

mqttClient.on("connect", () => {
  console.log("connected to mqtt");
  mqttClient.subscribe("ekos/commands/+/+", () => { });
});

mqttClient.on("message", (topic, message) => {
  const topicSplit = topic.split("/");
  const channel = topicSplit[2];
  const msgObj = JSON.parse(message);

  if (debug) {
    console.log([topic, msgObj]);
  }

  switch (channel) {
    case "media":
      mediaServer.clients.forEach(c => {
        c.send(JSON.stringify(msgObj));
      })
      break;
    case "message":
      messageServer.clients.forEach(c => {
        c.send(JSON.stringify(msgObj));
      })
      break;
    case "cloud":
      cloudServer.clients.forEach(c => {
        c.send(JSON.stringify(msgObj));
      })
      break;
  }
});

enableGracefulShutdown(server, 1000);

// Ekos in offline mode will try to connect to localhost:3000.
server.listen(3000);

// To enable cloud mode locally, add live.stellarmate.com to your hosts file.
// You will also need to listen on https. this is left as an exercise to the reader
