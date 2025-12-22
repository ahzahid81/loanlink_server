require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET || "");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

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


const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

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


function verifyJWT(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: "Unauthorized: No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT verify error:", err);
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
}


function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden: Role Denied" });
    }
    next();
  };
}


app.get("/", (req, res) => {
  res.send("LoanLink API Running ✔️");
});


app.post("/jwt", async (req, res) => {
  try {
    const { email, name, photoURL } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    let user = await userCollection.findOne({ email });

    if (!user) {
      const newUser = {
        name: name || "",
        email,
        photoURL: photoURL || "",
        role: "borrower",
        status: "active",
        createdAt: new Date(),
      };
      const r = await userCollection.insertOne(newUser);
      user = { _id: r.insertedId, ...newUser };
    }

    if (user.status === "suspended") {
      return res.status(403).json({ message: "Your account is suspended" });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, role: user.role });
  } catch (err) {
    console.error("POST /jwt error:", err);
    res.status(500).json({ message: "JWT generation failed" });
  }
});


app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.json({ success: true });
});


app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL, role, status } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const exists = await userCollection.findOne({ email });
    if (exists) return res.status(200).json({ message: "User exists", user: exists });

    const userDoc = {
      name: name || "",
      email,
      photoURL: photoURL || "",
      role: role || "borrower",
      status: status || "active",
      createdAt: new Date(),
    };

    const result = await userCollection.insertOne(userDoc);
    res.status(201).json({ message: "User created", user: { _id: result.insertedId, ...userDoc } });
  } catch (err) {
    console.error("POST /users error:", err);
    res.status(500).json({ message: "User create failed" });
  }
});


app.get("/users", verifyJWT, requireRole("admin"), async (req, res) => {
  try {
    const users = await userCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});


app.patch("/users/:id", verifyJWT, requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const update = req.body;
    await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /users/:id error:", err);
    res.status(500).json({ message: "Failed to update user" });
  }
});


app.post("/loans", verifyJWT, requireRole("manager"), async (req, res) => {
  try {
    const loan = req.body;
    loan.createdBy = req.user.email;
    loan.createdAt = new Date();
    loan.showOnHome = loan.showOnHome || false;
    const result = await loanCollection.insertOne(loan);
    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    console.error("POST /loans error:", err);
    res.status(500).json({ message: "Failed to create loan" });
  }
});


app.get("/loans", async (req, res) => {
  try {
    const { limit = 0, page = 1, showOnHome, search } = req.query;
    const q = {};
    if (showOnHome === "true") q.showOnHome = true;
    if (search) q.$text = { $search: search }; // requires text index on relevant fields
    const skip = limit > 0 ? (Number(page) - 1) * Number(limit) : 0;
    const cursor = loanCollection.find(q).skip(skip).limit(Number(limit) || 0);
    const loans = await cursor.toArray();
    res.json(loans);
  } catch (err) {
    console.error("GET /loans error:", err);
    res.status(500).json({ message: "Failed to fetch loans" });
  }
});


app.get("/loans/:id", async (req, res) => {
  try {
    const loan = await loanCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    res.json(loan);
  } catch (err) {
    console.error("GET /loans/:id error:", err);
    res.status(500).json({ message: "Failed to fetch loan" });
  }
});


app.patch("/loans/:id", verifyJWT, async (req, res) => {
  try {
    const update = req.body;
    await loanCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /loans/:id error:", err);
    res.status(500).json({ message: "Failed to update loan" });
  }
});


app.delete("/loans/:id", verifyJWT, requireRole("manager", "admin"), async (req, res) => {
  try {
    await loanCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /loans/:id error:", err);
    res.status(500).json({ message: "Failed to delete loan" });
  }
});


app.patch("/loans/:id/home", verifyJWT, requireRole("admin"), async (req, res) => {
  try {
    const { showOnHome } = req.body;
    await loanCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { showOnHome } });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /loans/:id/home error:", err);
    res.status(500).json({ message: "Failed to toggle showOnHome" });
  }
});


app.post("/applications", verifyJWT, async (req, res) => {
  try {
    const appDoc = req.body;
    appDoc.userEmail = req.user.email;
    appDoc.status = "Pending";
    appDoc.applicationFeeStatus = "Unpaid";
    appDoc.createdAt = new Date();
    const result = await applicationCollection.insertOne(appDoc);
    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    console.error("POST /applications error:", err);
    res.status(500).json({ message: "Failed to create application" });
  }
});


app.get("/applications", verifyJWT, async (req, res) => {
  try {
    const role = req.user.role;
    const q = {};
    if (role === "borrower") q.userEmail = req.user.email;

    const apps = await applicationCollection.find(q).toArray();
    res.json(apps);
  } catch (err) {
    console.error("GET /applications error:", err);
    res.status(500).json({ message: "Failed to fetch applications" });
  }
});


app.patch("/applications/:id/status", verifyJWT, requireRole("manager"), async (req, res) => {
  try {
    const { status } = req.body;
    const update = { status };
    if (status === "Approved") update.approvedAt = new Date();
    else update.approvedAt = null;
    await applicationCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /applications/:id/status error:", err);
    res.status(500).json({ message: "Failed to update application status" });
  }
});


app.patch("/applications/:id/cancel", verifyJWT, async (req, res) => {
  try {
    const id = req.params.id;
    const appData = await applicationCollection.findOne({ _id: new ObjectId(id) });
    if (!appData) return res.status(404).json({ message: "Application not found" });
    if (appData.userEmail !== req.user.email) return res.status(403).json({ message: "Forbidden" });
    if (appData.status !== "Pending") return res.status(400).json({ message: "Cannot cancel unless Pending" });
    await applicationCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "Cancelled" } });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /applications/:id/cancel error:", err);
    res.status(500).json({ message: "Failed to cancel application" });
  }
});


/* ================================
   STRIPE CHECKOUT
================================ */
app.post("/create-checkout-session", verifyJWT, async (req, res) => {
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ message: "Application ID required" });

  const application = await applicationCollection.findOne({
    _id: new ObjectId(applicationId),
  });

  if (!application) return res.status(404).json({ message: "Application not found" });

  /**
   * 🔴 IMPORTANT
   * We attach applicationId to metadata
   * So payment success can update the correct document
   */
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",

    metadata: {
      applicationId: application._id.toString(),
      userEmail: application.userEmail,
    },

    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: 1000, // $10 fixed
          product_data: {
            name: "Loan Application Fee",
            description: application.loanTitle,
          },
        },
        quantity: 1,
      },
    ],

    success_url: `${process.env.CLIENT_ORIGIN}/payment-success/${applicationId}`,
    cancel_url: `${process.env.CLIENT_ORIGIN}/payment/cancel`,
  });

  res.json({ url: session.url });
});


app.post("/payment-success/:id", async (req, res) => {
  const id = req.params.id;


  await applicationCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        applicationFeeStatus: "Paid",
        paidAt: new Date(),
        payment: {
          txId: "stripe_checkout", 
          email: "stripe@checkout.com",
          amount: 10,
        },
      },
    }
  );

  res.json({ success: true });
});


app.get("/dashboard-stats", verifyJWT, async (req, res) => {
  try {
    const role = req.user.role;

    const totalLoans = await loanCollection.countDocuments();
    const totalApplications = await applicationCollection.countDocuments();

    const pending = await applicationCollection.countDocuments({ status: "Pending" });
    const approved = await applicationCollection.countDocuments({ status: "Approved" });
    const rejected = await applicationCollection.countDocuments({ status: "Rejected" });

    // Monthly aggregation (last 6 months)
    const monthly = await applicationCollection.aggregate([
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]).toArray();

    res.json({
      totalLoans,
      totalApplications,
      pending,
      approved,
      rejected,
      monthly
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load dashboard stats" });
  }
});


connectDB()
  .then(() => {
    app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
