const express = require("express");
require("dotenv").config();
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");
const cors = require("cors");
const multer = require("multer");
const compression = require("compression"); // Added for GZIP compression

const app = express();
const port = process.env.PORT || 9000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(compression()); // Enable GZIP compression for responses



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9fb8p.mongodb.net/tiktok_tasin?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function run() {
  try {
    await client.connect();
    const database = client.db("tiktok");
    const videoCollection = database.collection("videoDetails");
    const adminCollection = database.collection("admin");
    const bucket = new GridFSBucket(database, {
      bucketName: "videos",
      chunkSizeBytes: 1024 * 1024, // 1 MB chunks for better upload performance
    });

    console.log("Connected to MongoDB");

    // Configure multer for file upload
    const storage = multer.memoryStorage();
    const upload = multer({ storage });

    // Endpoint to upload video details and video file
    app.post("/videoDetails", upload.single("videoFile"), async (req, res) => {
      try {
        const { title, description, name, email } = req.body;
        const likes = JSON.parse(req.body.likes || "[]");
        const comments = JSON.parse(req.body.comments || "[]");
        const videoFile = req.file;

        if (!videoFile) {
          return res
            .status(400)
            .json({ success: false, message: "No file uploaded" });
        }

        // Log parsed fields to ensure they are correct

        // Stream video to GridFS
        const uploadStream = bucket.openUploadStream(videoFile.originalname, {
          contentType: videoFile.mimetype,
          metadata: { title, description },
        });

        uploadStream.end(videoFile.buffer, async () => {
          const videoDetails = {
            title,
            description,
            name,
            email,
            fileId: uploadStream.id,
            filename: videoFile.originalname,
            uploadDate: new Date(),
            videoUrl: `http://localhost:${port}/videos/${uploadStream.id}`,
            likes,
            comments,
          };

          // Save metadata asynchronously
          await videoCollection.insertOne(videoDetails);

          res.json({
            success: true,
            message: "Video uploaded successfully",
            videoUrl: videoDetails.videoUrl,
          });
        });
      } catch (error) {
        console.error("Error uploading video:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Endpoint to like a video
    app.post("/videoDetails/:id/like", async (req, res) => {
      const { id } = req.params;
      const { userEmail, userName } = req.body;

      try {
        const video = await videoCollection.findOne({ _id: new ObjectId(id) });
        if (!video) {
          return res.status(404).json({ message: "Video not found" });
        }

        // Add user to likes array
        video.likes.push({ userEmail, userName });

        // Update the video with the new likes
        await videoCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { likes: video.likes } }
        );

        res.status(200).json({ message: "Video liked successfully!" });
      } catch (error) {
        console.error("Error liking video:", error);
        res.status(500).json({ message: "Error liking video" });
      }
    });

    // Endpoint to dislike a video
    app.delete("/videoDetails/:id/dislike", async (req, res) => {
      const videoId = req.params.id;
      const { userEmail } = req.body;

      try {
        if (!videoId || !userEmail) {
          return res
            .status(400)
            .json({ message: "Invalid video ID or user email" });
        }

        const result = await videoCollection.updateOne(
          { _id: new ObjectId(videoId) },
          { $pull: { likes: { userEmail } } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Video not found" });
        }

        res.status(200).json({ message: "Disliked successfully!" });
      } catch (error) {
        res.status(500).json({ message: "Error disliking video", error });
      }
    });

    // Endpoint to add a comment
    app.post("/videoDetails/:id/comment", async (req, res) => {
      const { id } = req.params;
      const { userEmail, userName, comment, time } = req.body;

      try {
        const video = await videoCollection.findOne({ _id: new ObjectId(id) });
        if (!video) {
          return res.status(404).json({ message: "Video not found" });
        }

        video.comments.push({ userEmail, userName, comment, time });

        await videoCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { comments: video.comments } }
        );

        res.status(200).json({ message: "Comment added successfully!" });
      } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ message: "Error adding comment" });
      }
    });

    // Endpoint to fetch all video details
    app.get("/videoDetails", async (req, res) => {
      try {
        const videos = await videoCollection.find({}).toArray();
        res.json(videos);
      } catch (error) {
        console.error("Error fetching videos:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Endpoint to stream video by ID
    app.get("/videoDetails/:id", async (req, res) => {
      try {
        const fileId = new ObjectId(req.params.id);

        const file = await database
          .collection("videos.files")
          .findOne({ _id: fileId });

        if (!file) {
          return res
            .status(404)
            .json({ success: false, message: "Video not found" });
        }

        res.set("Content-Type", file.contentType);

        const downloadStream = bucket.openDownloadStream(fileId);
        downloadStream.pipe(res);
      } catch (error) {
        console.error("Error streaming video:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Endpoint to delete a video
    app.delete("/videoDetails/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await videoCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.json({ message: "Video deleted successfully" });
        } else {
          res.status(404).json({ error: "Video not found" });
        }
      } catch (error) {
        res.status(500).json({ error: "Failed to delete video" });
      }
    });

    // Admin API
    app.post("/admin", async (req, res) => {
      const newUser = req.body;
      const result = await adminCollection.insertOne(newUser);
      res.json(result);
    });

    app.get("/admin", async (req, res) => {
      const user = await adminCollection.findOne({});
      res.send(user);
    });
  } finally {
    // Keep the MongoDB connection open
  }
}
run().catch(console.dir);

// Default route
app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
