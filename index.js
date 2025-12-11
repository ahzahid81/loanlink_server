require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET || "dummy");
const {
  MongoClient,
  ObjectId,
  ServerApiVersion,
} = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;


app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());


//Mongo Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


//Collection
let userCollection, loanCollection, applicationCollection, paymentCollection;

async function connectDB() {
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  userCollection = db.collection("users");
  loanCollection = db.collection("loans");
  applicationCollection = db.collection("applications");
  paymentCollection = db.collection("payments");

  console.log("🔥 MongoDB Connected");
}


//JSON Web Token
function verifyJWT(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No Token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Invalid Token" });
  }
}


//Middleware Required Roles
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!roles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden: Role Denied" });
    }

    next();
  };
}


connectDB().then(() => {
  app.listen(port, () =>
    console.log(`🚀 Server running on port ${port}`)
  );
});