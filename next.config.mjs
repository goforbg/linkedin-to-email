/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    APOLLO_APIS: process.env.APOLLO_APIS,
    MONGODB_URI: process.env.MONGODB_URI,
    MAILZY_SEC: process.env.MAILZY_SEC
  }
};

export default nextConfig;
