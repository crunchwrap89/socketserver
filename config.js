module.exports = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 7076,
    ORIGINS: process.env.ORIGINS || ["http://localhost", "https://mapcanvas3d.com", "http://127.0.0.1:5173"],
    HOST: process.env.HOST || "localhost"
  }