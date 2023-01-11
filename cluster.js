const cluster = require("cluster");
const http = require("http");
const { setupMaster } = require("@socket.io/sticky");
const config = require("./config.js");

const WORKERS_COUNT = 4;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  for (let i = 0; i < WORKERS_COUNT; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });

  const httpServer = http.createServer();
  setupMaster(httpServer, {
    loadBalancingMethod: "least-connection", // either "random", "round-robin" or "least-connection"
  });
  const PORT = config.PORT || 7076;

  httpServer.listen(PORT, () =>
    console.log(`server listening at http://*:${PORT}`)
  );
} else {
  console.log(`Worker ${process.pid} started`);
  require("./index");
}
