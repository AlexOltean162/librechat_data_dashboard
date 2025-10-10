import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mongoUri = buildMongoUri();
const mongoDbName = process.env.MONGODB_DB || 'LibreChat';

if (!mongoUri) {
  console.warn('Warning: MongoDB connection details are missing. Configure environment variables before starting the server.');
}

const client = mongoUri
  ? new MongoClient(mongoUri, {
      maxPoolSize: 10
    })
  : null;

function buildMongoUri() {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const host = process.env.MONGODB_HOST;
  const port = process.env.MONGODB_PORT || '27017';
  const username = process.env.MONGODB_USERNAME;
  const password = process.env.MONGODB_PASSWORD;
  const dbName = process.env.MONGODB_DB || 'LibreChat';
  const authSource = process.env.MONGODB_AUTH_SOURCE;

  if (!host) {
    return null;
  }

  const credentials = username && password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';

  const query = authSource ? `?authSource=${encodeURIComponent(authSource)}` : '';

  return `mongodb://${credentials}${host}:${port}/${dbName}${query}`;
}

async function getDb() {
  if (!client) {
    throw new Error('MongoDB client is not configured. Set MONGODB_URI or individual connection variables.');
  }

  if (!client.topology || !client.topology.isConnected()) {
    try {
      await client.connect();
    } catch (error) {
      if (error?.code === 18 || error?.codeName === 'AuthenticationFailed') {
        console.error('MongoDB authentication failed. Verify your username/password and ensure special characters are percent-encoded.');
      }
      throw error;
    }
  }
  return client.db(mongoDbName);
}

app.get('/api/health', async (_req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const db = await getDb();
    const usersCollection = db.collection('users');
    const agentsCollection = db.collection('agents');
    const messagesCollection = db.collection('messages');

    const [totalUsers, totalAgents, totalMessages] = await Promise.all([
      usersCollection.countDocuments(),
      agentsCollection.countDocuments(),
      messagesCollection.countDocuments()
    ]);

    const agentsPerCategory = await agentsCollection
      .aggregate([
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'agentcategories',
            localField: '_id',
            foreignField: 'value',
            as: 'categoryDocs'
          }
        },
        {
          $addFields: {
            category: {
              $cond: {
                if: { $gt: [{ $size: '$categoryDocs' }, 0] },
                then: { $arrayElemAt: ['$categoryDocs.label', 0] },
                else: {
                  $ifNull: ['$_id', 'Uncategorized']
                }
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            category: 1,
            count: 1
          }
        },
        { $sort: { count: -1 } }
      ])
      .toArray();

    const messagesPerUser = await messagesCollection
      .aggregate([
        {
          $group: {
            _id: '$user',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 15 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'userDocs'
          }
        },
        {
          $addFields: {
            userLabel: {
              $cond: {
                if: { $gt: [{ $size: '$userDocs' }, 0] },
                then: {
                  $let: {
                    vars: {
                      userDoc: { $arrayElemAt: ['$userDocs', 0] }
                    },
                    in: {
                      $ifNull: ['$$userDoc.username', '$$userDoc.email']
                    }
                  }
                },
                else: {
                  $ifNull: ['$_id', 'Unknown']
                }
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            userId: '$_id',
            userLabel: 1,
            count: 1
          }
        }
      ])
      .toArray();

    const messagesPerDay = await messagesCollection
      .aggregate([
        {
          $match: {
            createdAt: { $type: 'date' }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } }
      ])
      .toArray();

    const usersLoggedPerDay = await usersCollection
      .aggregate([
        {
          $match: {
            updatedAt: { $type: 'date' }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$updatedAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } }
      ])
      .toArray();

    const messagesTable = await messagesCollection
      .aggregate([
        {
          $project: {
            _id: 0,
            messageId: '$messageId',
            conversationId: '$conversationId',
            user: '$user',
            sender: '$sender',
            text: {
              $ifNull: ['$text', '$content']
            },
            createdAt: 1
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: 50 }
      ])
      .toArray();

    res.json({
      totals: {
        users: totalUsers,
        agents: totalAgents,
        messages: totalMessages
      },
      agentsPerCategory,
      messagesPerUser,
      messagesPerDay,
      usersLoggedPerDay,
      messagesTable
    });
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    res.status(500).json({ error: 'Failed to load dashboard data.', message: error.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LibreChat data dashboard server listening on port ${port}`);
});
