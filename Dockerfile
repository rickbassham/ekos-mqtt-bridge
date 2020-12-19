FROM node:lts

RUN mkdir /app

EXPOSE 3000

WORKDIR /app

COPY package.json /app

RUN npm install

COPY ./src /app

CMD ["node", "index.js"]
