FROM node:latest
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY ./ .
EXPOSE 7076
CMD [ "node", "cluster.js" ]