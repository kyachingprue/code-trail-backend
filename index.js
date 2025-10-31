const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const admin = require('firebase-admin');
const port = process.env.PORT || 5000;
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Middleware
app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  })
);
app.use(express.json());

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Ensure the uploads/videos folder exists
const uploadDir = path.join(__dirname, 'uploads/videos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  },
});

// Filter: only accept video files
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed!'), false);
  }
};

// Initialize multer
const upload = multer({ storage, fileFilter });

// Serve uploaded videos statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nhw49.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Collections
const studentsCollection = client.db('school-mate').collection('students');
const teachersCollection = client.db('school-mate').collection('teachers');
const videosCollection = client.db('school-mate').collection('videos');
const announcementsCollection = client
  .db('school-mate')
  .collection('announcements');
const assignmentSubmissionsCollection = client
  .db('school-mate')
  .collection('assignmentSubmit');
const assignmentsCollection = client
  .db('school-mate')
  .collection('assignments');
const quizzesTasksCollection = client
  .db('school-mate')
  .collection('quizzesTasks');
const enrolledCoursesCollection = client
  .db('school-mate')
  .collection('enrolledCourses');
const teacherRequestsCollection = client
  .db('school-mate')
  .collection('teacherRequests');
const usersCollection = client.db('school-mate').collection('users');
const messagesCollection = client.db('school-mate').collection('messages');

async function run() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // GET user by email
    app.get('/users/email/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ error: 'User not found' });

        res.send(user); // includes role, name, image, etc.
      } catch (error) {
        console.error('❌ Fetch user error:', error);
        res.status(500).send({ error: 'Failed to fetch user data' });
      }
    });
    app.get('/users/role', async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).send({ error: 'Email is required' });

        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ error: 'User not found' });

        res.send({ role: user.role });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Server error' });
      }
    });

    // GET profile data by email
    app.get('/profile/:email', async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Find user role
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let profileData;

        if (user.role === 'student') {
          profileData = await studentsCollection.findOne({ email });
        } else if (user.role === 'teacher') {
          profileData = await teachersCollection.findOne({ email });
        } else if (user.role === 'admin') {
          // For simplicity, store admin in usersCollection only
          profileData = user;
        }

        res.json({ role: user.role, profileData });
      } catch (error) {
        console.error('❌ Fetch profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
      }
    });

    // Student & Teacher communication

    // ✅ Get all messages between a student and a teacher
    app.get('/messages/:user1/:user2', async (req, res) => {
      try {
        const { user1, user2 } = req.params;

        const messages = await messagesCollection
          .find({
            $or: [
              { senderEmail: user1, receiverEmail: user2 },
              { senderEmail: user2, receiverEmail: user1 },
            ],
          })
          .sort({ createdAt: 1 }) // oldest to newest
          .toArray();

        res.status(200).json(messages);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    // Get user role by email
    app.get('/users/role', async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      try {
        const user = await usersCollection.findOne(
          { email },
          { projection: { role: 1 } }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ role: user.role });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // ✅ Get all conversations for a user (student or teacher)
    app.get('/conversations/:userEmail', async (req, res) => {
      const { userEmail } = req.params;

      try {
        const messages = await messagesCollection
          .find({
            $or: [{ senderEmail: userEmail }, { receiverEmail: userEmail }],
          })
          .toArray();

        if (!messages)
          return res.status(404).json({ error: 'No conversations found' });

        const partnerEmails = [
          ...new Set(
            messages.map(msg =>
              msg.senderEmail === userEmail
                ? msg.receiverEmail
                : msg.senderEmail
            )
          ),
        ];

        const partners = await usersCollection
          .find({ email: { $in: partnerEmails } })
          .project({ name: 1, email: 1 })
          .toArray();

        const enrichedPartners = partners.map(p => {
          const lastMsg = messages
            .filter(
              m => m.senderEmail === p.email || m.receiverEmail === p.email
            )
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

          return {
            ...p,
            lastMessage: lastMsg?.message || '',
            lastTime: lastMsg?.createdAt || null,
          };
        });

        res.json(enrichedPartners);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // 🟢 Add a new teacher to student’s conversation list (with debugging)
    app.post('/addTeacher', async (req, res) => {
      const { studentEmail, teacherEmail } = req.body;
      if (!studentEmail || !teacherEmail) {
        return res
          .status(400)
          .json({ success: false, message: 'Missing fields' });
      }

      try {
        // Check teacher exists in usersCollection
        const teacher = await usersCollection.findOne({
          email: teacherEmail.trim().toLowerCase(),
          role: 'teacher',
        });
        if (!teacher) {
          return res
            .status(404)
            .json({ success: false, message: 'Teacher not found' });
        }

        // Check if conversation already exists
        const exists = await messagesCollection.findOne({
          $or: [
            { senderEmail: studentEmail, receiverEmail: teacherEmail },
            { senderEmail: teacherEmail, receiverEmail: studentEmail },
          ],
        });

        if (exists) {
          return res.json({ success: false, message: 'Teacher already added' });
        }

        // Create starter conversation
        await messagesCollection.insertOne({
          senderEmail: studentEmail,
          receiverEmail: teacherEmail,
          message: '👋 Conversation started',
          createdAt: new Date(),
        });

        res.json({ success: true, message: 'Teacher added successfully' });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          success: false,
          message: 'Server error',
          error: err.message,
        });
      }
    });

    // Add a new student to teacher's conversation list
    app.post('/addStudent', async (req, res) => {
      const { teacherEmail, studentEmail } = req.body;

      if (!teacherEmail || !studentEmail) {
        return res
          .status(400)
          .json({ success: false, message: 'Missing fields' });
      }

      try {
        // Check if student exists
        const student = await usersCollection.findOne({
          email: studentEmail.trim().toLowerCase(),
          role: 'student',
        });
        if (!student) {
          return res
            .status(404)
            .json({ success: false, message: 'Student not found' });
        }

        // Check if conversation already exists
        const exists = await messagesCollection.findOne({
          $or: [
            { senderEmail: teacherEmail, receiverEmail: studentEmail },
            { senderEmail: studentEmail, receiverEmail: teacherEmail },
          ],
        });

        if (exists) {
          return res.json({ success: false, message: 'Student already added' });
        }

        // Create starter conversation
        await messagesCollection.insertOne({
          senderEmail: teacherEmail,
          receiverEmail: studentEmail,
          message: '👋 Conversation started',
          createdAt: new Date(),
        });

        res.json({ success: true, message: 'Student added successfully' });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          success: false,
          message: 'Server error',
          error: err.message,
        });
      }
    });

    // ✅ Send a new message
    app.post('/messages', async (req, res) => {
      try {
        const { senderEmail, receiverEmail, message } = req.body;
        if (!senderEmail || !receiverEmail || !message)
          return res.status(400).json({ error: 'All fields are required' });

        const newMessage = {
          senderEmail,
          receiverEmail,
          message,
          createdAt: new Date(),
        };

        const result = await messagesCollection.insertOne(newMessage);
        res.status(201).json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send message' });
      }
    });

    // Student Dashboard ---------->
    // GET student by email
    app.get('/students/email/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const student = await studentsCollection.findOne({ email });
        if (!student)
          return res.status(404).send({ error: 'Student not found' });

        res.send(student);
      } catch (error) {
        console.error('❌ Fetch student error:', error);
        res.status(500).send({ error: 'Failed to fetch student data' });
      }
    });

    // Get all announcements for student
    app.get('/student/announcements', async (req, res) => {
      try {
        const announcements = await announcementsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.json(announcements);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    app.get('/videos/:language', async (req, res) => {
      try {
        const language = req.params.language;
        const videos = await videosCollection.find({ language }).toArray();
        res.send(videos);
      } catch (error) {
        console.error('❌ Fetch videos error:', error);
        res.status(500).send({ error: 'Failed to fetch videos' });
      }
    });

    app.get('/videos/:language/:category', async (req, res) => {
      try {
        const { language, category } = req.params;
        const videos = await videosCollection
          .find({ language, category })
          .toArray();
        res.send(videos);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch videos by category' });
      }
    });

    // GET all tasks/quizzes
    app.get('/quizzes-tasks', async (req, res) => {
      try {
        const tasks = await quizzesTasksCollection.find().toArray();
        res.send(tasks);
      } catch (err) {
        res.status(500).send({ error: 'Failed to fetch tasks/quizzes' });
      }
    });

    // Fetch all assignments
    app.get('/assignments', async (req, res) => {
      try {
        const assignments = await assignmentsCollection.find().toArray();
        res.send(assignments);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to fetch assignments' });
      }
    });

    // ✅ must exist on your server.js or index.js
    app.get('/student/assignments/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const submissions = await assignmentSubmissionsCollection
          .find({ studentEmail: email })
          .sort({ submittedAt: -1 })
          .toArray();

        res.send(submissions);
      } catch (err) {
        console.error('❌ Error fetching student assignments:', err);
        res.status(500).send({ error: 'Failed to load student assignments' });
      }
    });

    app.get('/my-courses/:email', async (req, res) => {
      const email = req.params.email;
      const courses = await enrolledCoursesCollection
        .find({ studentEmail: email })
        .toArray();
      res.send(courses);
    });

    // 🔹 Register new student (Student Registration - Admin Dashboard)
    app.post('/students/register', async (req, res) => {
      try {
        const {
          name,
          gender,
          yourOld,
          mobileNumber,
          country,
          division,
          district,
          village,
          guardianName,
          birthday,
          email,
          image,
        } = req.body;

        // 🔸 Step 1: Basic validation
        if (!name || !email) {
          return res.status(400).send({ error: 'Name and Email are required' });
        }

        // 🔸 Step 2: Check if email already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).send({ error: 'Email already registered' });
        }

        // 🔸 Step 3: Get total students count for roll number
        const totalStudents = await studentsCollection.countDocuments();
        const roll = totalStudents + 1; // 👈 Dynamic roll number

        // 🔸 Step 4: Common fields
        const role = 'student';
        const createdAt = new Date();
        const last_login = new Date();

        // 🔸 Step 5: Save basic user data
        const userData = {
          name,
          email,
          image: image || '',
          role,
          createdAt,
          last_login,
          roll, // 👈 Add roll here too for easy reference
        };
        const userResult = await usersCollection.insertOne(userData);

        // 🔸 Step 6: Save student details
        const studentData = {
          name,
          gender,
          yourOld,
          mobileNumber,
          country,
          division,
          district,
          village,
          guardianName,
          birthday,
          email,
          image: image || '',
          role,
          createdAt,
          last_login,
          roll, // 👈 Dynamic roll number
        };
        const studentResult = await studentsCollection.insertOne(studentData);

        // 🔸 Step 7: Success response
        res.status(201).send({
          message: '🎓 Student registered successfully!',
          roll: roll,
          userId: userResult.insertedId,
          studentId: studentResult.insertedId,
        });
      } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).send({ error: 'Failed to register student' });
      }
    });

    // ✅ POST: student submits assignment link
    app.post('/assignments/submit', async (req, res) => {
      try {
        const { assignmentId, submissionLink, studentEmail, studentName } =
          req.body;

        if (!assignmentId || !submissionLink || !studentEmail || !studentName) {
          return res.status(400).send({ error: 'All fields are required' });
        }

        const submission = {
          assignmentId: new ObjectId(assignmentId),
          submissionLink,
          studentEmail,
          studentName,
          submittedAt: new Date(),
          status: 'submitted',
        };

        const result = await assignmentSubmissionsCollection.insertOne(
          submission
        );

        res.status(201).send({
          success: true,
          message: 'Assignment submitted successfully',
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error('❌ Failed to submit assignment:', err);
        res.status(500).send({ error: 'Failed to submit assignment' });
      }
    });

    // 🔹 POST: Create a new teacher request
    app.post('/teacher-requests', async (req, res) => {
      try {
        const { name, email, course, message } = req.body;

        if (!name || !email || !course) {
          return res
            .status(400)
            .send({ error: 'Name, email, and course are required' });
        }

        const newRequest = {
          name,
          email,
          course,
          message: message || '',
          status: 'Pending',
          createdAt: new Date(),
        };

        const result = await teacherRequestsCollection.insertOne(newRequest);
        res.status(201).send({
          success: true,
          message: 'Teacher request sent successfully!',
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error('❌ Error creating teacher request:', error);
        res.status(500).send({ error: 'Failed to create teacher request' });
      }
    });

    //-----Teacher Dashboard ----->
    // 🔹 Get a teacher by email
    app.get('/teachers/email/:email', async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) return res.status(400).send({ error: 'Email is required' });

        const teacher = await teachersCollection.findOne({ email });
        if (!teacher)
          return res.status(404).send({ error: 'Teacher not found' });

        res.send(teacher);
      } catch (error) {
        console.error('❌ Error fetching teacher by email:', error);
        res.status(500).send({ error: 'Failed to fetch teacher data' });
      }
    });

    // ✅ Get all assignments for a teacher
    app.get('/assignments/teacher/:email', async (req, res) => {
      const email = req.params.email;
      const assignments = await assignmentsCollection
        .find({ uploadedBy: email })
        .toArray();
      res.send(assignments);
    });

    // Get all announcements for teacher
    app.get('/teacher/announcements', async (req, res) => {
      try {
        const announcements = await announcementsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.json(announcements);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    app.get('/teacher/submissions/:email', async (req, res) => {
      const email = req.params.email;
      const teacherAssignments = await assignmentsCollection
        .find({ uploadedBy: email })
        .toArray();
      const assignmentIds = teacherAssignments.map(a => a._id.toString());
      const submissions = await assignmentSubmissionsCollection
        .find({})
        .toArray();
      const filtered = submissions.filter(sub =>
        assignmentIds.includes(sub.assignmentId.toString())
      );
      res.send(filtered);
    });

    // 🔹 Get all videos uploaded by a specific teacher
    app.get('/teacher/videos/:email', async (req, res) => {
      const email = req.params.email;
      try {
        const videos = await videosCollection
          .find({ uploadedBy: email })
          .toArray();
        res.send(videos);
      } catch (error) {
        console.error('❌ Error fetching teacher videos:', error);
        res.status(500).send({ error: 'Failed to fetch teacher videos' });
      }
    });

    // ✅ Create Assignment
    app.post('/assignments', upload.single('file'), async (req, res) => {
      try {
        const { language, title, description, uploadedBy } = req.body;

        if (!language || !title || !uploadedBy) {
          return res
            .status(400)
            .send({ error: 'Language, title and uploadedBy are required' });
        }

        const newAssignment = {
          language,
          title,
          description: description || '',
          uploadedBy,
          createdAt: new Date(),
        };

        const result = await assignmentsCollection.insertOne(newAssignment);
        res.status(201).send({
          success: true,
          message: '📝 Assignment created successfully',
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error('❌ Error creating assignment:', error);
        res.status(500).send({ error: 'Failed to create assignment' });
      }
    });

    // 🔹 Upload video
    app.post(
      '/teacher/videos',
      upload.single('videoFile'),
      async (req, res) => {
        try {
          const { language, category, title, description, uploadedBy } =
            req.body;
          const videoUrl = req.file
            ? `/uploads/videos/${req.file.filename}`
            : null;

          if (!language || !category || !title || !uploadedBy || !videoUrl) {
            return res.status(400).send({ error: 'All fields are required' });
          }

          const newVideo = {
            language,
            category,
            title,
            videoUrl,
            description: description || '',
            uploadedBy,
            createdAt: new Date(),
          };

          const result = await videosCollection.insertOne(newVideo);
          res.status(201).send({
            success: true,
            message: '🎥 Video uploaded successfully',
            insertedId: result.insertedId,
          });
        } catch (error) {
          console.error('❌ Error uploading video:', error);
          res.status(500).send({ error: 'Failed to upload video' });
        }
      }
    );

    app.put('/teacher/videos/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { title, description, category, language } = req.body;

        const updatedDoc = {
          $set: {
            title,
            description,
            category,
            language,
            updatedAt: new Date(),
          },
        };

        const result = await videosCollection.updateOne(
          { _id: new ObjectId(id) },
          updatedDoc
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ error: 'Video not found' });

        res.send({ success: true, message: 'Video updated successfully' });
      } catch (error) {
        console.error('❌ Error updating video:', error);
        res.status(500).send({ error: 'Failed to update video' });
      }
    });

    // ✅ Optional: Update assignment
    app.put('/assignments/:id', upload.single('file'), async (req, res) => {
      try {
        const id = req.params.id;
        const { language, title, description } = req.body;
        const updateData = {
          language,
          title,
          description,
        };

        const result = await assignmentsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: 'Assignment not found' });
        }

        res.send({ success: true, message: 'Assignment updated successfully' });
      } catch (error) {
        console.error('❌ Error updating assignment:', error);
        res.status(500).send({ error: 'Failed to update assignment' });
      }
    });

    app.delete('/teacher/videos/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await videosCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0)
          return res.status(404).send({ error: 'Video not found' });

        res.send({ success: true, message: 'Video deleted successfully' });
      } catch (error) {
        console.error('❌ Error deleting video:', error);
        res.status(500).send({ error: 'Failed to delete video' });
      }
    });

    // ✅ Delete assignment
    app.delete('/teacher/assignments/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await assignmentsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ error: 'Assignment not found' });
        }
        res.send({ success: true, message: 'Assignment deleted successfully' });
      } catch (error) {
        console.error('❌ Error deleting assignment:', error);
        res.status(500).send({ error: 'Failed to delete assignment' });
      }
    });

    // Admin Dashboard----->

    // 🔹 Get all students (Admin Dashboard)
    app.get('/admin/students', async (req, res) => {
      try {
        const students = await studentsCollection.find().toArray();
        res.send(students);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // 🔹 Get all teachers (Admin Dashboard)
    app.get('/admin/teachers', async (req, res) => {
      try {
        const teachers = await teachersCollection.find().toArray();
        res.send(teachers);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get teacher by ID
    app.get('/admin/teachers/:id', async (req, res) => {
      try {
        const id = req.params.id;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid ID format' });
        }

        const teacher = await teachersCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!teacher) {
          return res.status(404).send({ error: 'Teacher not found' });
        }

        res.send(teacher);
      } catch (err) {
        console.error('Server error fetching teacher:', err.message);
        res
          .status(500)
          .send({ error: 'Internal Server Error', details: err.message });
      }
    });

    // GET all submissions (Admin)
    app.get('/admin/assignments', async (req, res) => {
      try {
        const submissions = await assignmentSubmissionsCollection
          .find({})
          .sort({ submittedAt: -1 })
          .toArray();
        // Convert assignmentId to string for client convenience (optional)
        const normalized = submissions.map(s => {
          return {
            ...s,
            _id: s._id,
            assignmentId: s.assignmentId ? String(s.assignmentId) : null,
          };
        });
        res.send(normalized);
      } catch (err) {
        console.error('❌ Error fetching submissions:', err);
        res.status(500).send({ error: 'Failed to fetch submissions' });
      }
    });

    // 🔹 Get single student by ID
    app.get('/admin/students/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const student = await studentsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!student)
          return res.status(404).send({ error: 'Student not found' });
        res.send(student);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // GET all teacher requests (for Admin dashboard)
    app.get('/admin/teacher-requests', async (req, res) => {
      try {
        const requests = await teacherRequestsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(requests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to fetch teacher requests' });
      }
    });

    // GET all videos (Admin dashboard)
    app.get('/admin/videos', async (req, res) => {
      try {
        const videos = await videosCollection.find().toArray();
        res.send(videos);
      } catch (err) {
        console.error('❌ Error fetching all videos:', err);
        res.status(500).send({ error: 'Failed to fetch videos' });
      }
    });

    // ✅ GET all quizzes/tasks (Admin)
    app.get('/admin/quizzes-tasks', async (req, res) => {
      try {
        const tasks = await quizzesTasksCollection.find().toArray();
        res.send(tasks);
      } catch (err) {
        console.error('Error fetching quizzes/tasks:', err);
        res.status(500).send({ error: 'Failed to fetch quizzes/tasks' });
      }
    });

    // Get all announcements (admin view)
    app.get('/admin/announcements', async (req, res) => {
      try {
        const announcements = await announcementsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.json(announcements);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Create a new announcement (admin only)
    app.post('/admin/announcements', async (req, res) => {
      try {
        const { title, message, sentBy, sentAt } = req.body;
        if (!title || !message) {
          return res
            .status(400)
            .json({ message: 'Title and message are required' });
        }

        const result = await announcementsCollection.insertOne({
          title,
          message,
          sentBy,
          sentAt,
          createdAt: new Date(),
        });

        res
          .status(201)
          .json({ message: 'Announcement sent', id: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // POST new quiz/task
    app.post('/admin/quizzes-tasks', async (req, res) => {
      try {
        const task = req.body;
        const result = await quizzesTasksCollection.insertOne(task);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to upload task/quiz' });
      }
    });

    // ✅ Update submission status (Admin)
    app.put('/admin/assignments/:id/status', async (req, res) => {
      try {
        const id = req.params.id;
        const { status, actedBy, mark, adminComments, markedBy, markedAt } =
          req.body;

        // Validate ID
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid submission ID' });
        }

        const updateData = {
          status,
          actedBy,
          ...(mark && { mark }),
          ...(adminComments && { adminComments }),
          ...(markedBy && { markedBy }),
          ...(markedAt && { markedAt }),
          updatedAt: new Date(),
        };

        const result = await assignmentSubmissionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: 'Submission not found' });
        }

        res.send({
          success: true,
          message: 'Submission status updated successfully',
        });
      } catch (err) {
        console.error('❌ Error updating assignment status:', err);
        res.status(500).send({ error: 'Failed to update assignment status' });
      }
    });

    // 🔹 Update student info
    app.put('/admin/students/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updatedStudent = { ...req.body };
        delete updatedStudent._id;

        const result = await studentsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedStudent }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.put('/admin/teachers/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updatedTeacher = { ...req.body };

        console.log('Updating teacher ID:', id);
        console.log('Payload:', updatedTeacher);

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid ID format' });
        }

        // Remove _id if present
        if (updatedTeacher._id) delete updatedTeacher._id;

        if (!updatedTeacher || Object.keys(updatedTeacher).length === 0) {
          return res.status(400).send({ error: 'No update data provided' });
        }

        const result = await teachersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedTeacher }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: 'Teacher not found' });
        }

        res.send({
          success: true,
          message: 'Teacher updated successfully',
          result,
        });
      } catch (err) {
        console.error('ERROR updating teacher:', err);
        res
          .status(500)
          .send({ error: 'Internal Server Error', details: err.message });
      }
    });

    // 🔹 Approve a teacher request and promote student to teacher
    app.put('/teacher-requests/approve/:id', async (req, res) => {
      try {
        const requestId = req.params.id;

        // 1️⃣ Find the teacher request
        const request = await teacherRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ error: 'Request not found' });

        // 2️⃣ Find the student data
        const student = await studentsCollection.findOne({
          email: request.email,
        });
        if (!student)
          return res.status(404).send({ error: 'Student data not found' });

        // 3️⃣ Update request status to "Approved"
        await teacherRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: 'Approved' } }
        );

        // 4️⃣ Update user role to teacher
        await usersCollection.updateOne(
          { email: student.email },
          { $set: { role: 'teacher', last_login: new Date() } }
        );

        // 6️⃣ Insert into teachers collection
        const teacherData = {
          name: student.name,
          email: student.email,
          gender: student.gender,
          yourOld: student.yourOld,
          mobileNumber: student.mobileNumber,
          country: student.country,
          division: student.division,
          district: student.district,
          village: student.village,
          guardianName: student.guardianName,
          birthday: student.birthday,
          image: student.image,
          role: 'teacher',
          createdAt: student.createdAt,
          last_login: student.last_login,
          courses: [
            {
              name: request.course,
              createdAt: new Date(),
              students: [],
            },
          ],
        };

        await teachersCollection.insertOne(teacherData);

        await studentsCollection.deleteOne({ email: student.email });

        res.send({
          success: true,
          message:
            '✅ Teacher request approved and student promoted to teacher!',
          teacherData,
        });
      } catch (error) {
        console.error('❌ Error approving teacher request:', error);
        res.status(500).send({ error: 'Failed to approve teacher request' });
      }
    });

    // 🔹 Reject a teacher request
    app.put('/teacher-requests/:id', async (req, res) => {
      try {
        const requestId = req.params.id;
        const { status } = req.body;

        // Only allow "Rejected" or "Pending" status change
        if (!['Rejected', 'Pending'].includes(status)) {
          return res
            .status(400)
            .send({ success: false, message: 'Invalid status' });
        }

        // Find the request
        const request = await teacherRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request) {
          return res
            .status(404)
            .send({ success: false, message: 'Request not found' });
        }

        // Update the request status
        await teacherRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status } }
        );

        res.send({
          success: true,
          message: `Request ${status.toLowerCase()} successfully`,
        });
      } catch (error) {
        console.error('❌ Error updating teacher request status:', error);
        res
          .status(500)
          .send({ success: false, message: 'Failed to update request status' });
      }
    });

    // ✅ UPDATE quizzes/tasks (Admin)
    app.put('/admin/quizzes-tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updatedTask = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid ID format' });
        }

        const result = await quizzesTasksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedTask }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: 'Task not found' });
        }

        res.send({
          success: true,
          message: 'Task updated successfully',
          result,
        });
      } catch (err) {
        console.error('Error updating task:', err.message);
        res
          .status(500)
          .send({ error: 'Internal Server Error', details: err.message });
      }
    });

    // DELETE a submission (Admin)
    app.delete('/admin/assignments/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid submission id' });
        }

        const result = await assignmentSubmissionsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: 'Submission not found' });
        }

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error('❌ Error deleting submission:', err);
        res.status(500).send({ error: 'Failed to delete submission' });
      }
    });

    // ✅ DELETE quizzes/tasks (Admin)
    app.delete('/admin/quizzes-tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await quizzesTasksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to delete task' });
      }
    });

    // 🔹 DELETE: Remove teacher request
    app.delete('/teacher-requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await teacherRequestsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Request not found' });
        }

        res.send({ success: true, message: 'Request deleted successfully' });
      } catch (error) {
        console.error('❌ Error deleting request:', error);
        res.status(500).send({ error: 'Failed to delete teacher request' });
      }
    });

    // 🔹 Delete student
    app.delete('/admin/students/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await studentsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
  } finally {
    // keep connection alive
  }
}
run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
  res.send('🚀 School Mate Server Running Successfully!');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
