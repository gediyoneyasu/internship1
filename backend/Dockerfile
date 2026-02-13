FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Use environment port if provided
ENV PORT=3016
EXPOSE 3016

CMD ["node", "app.js"]
