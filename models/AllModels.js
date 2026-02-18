const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const databaseUrl = process.env.DATABASE_URL;
const sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false,
    dialectOptions: {
        ssl: {
            require: true, // This will help in connecting to Heroku which requires SSL
            rejectUnauthorized: false // This is needed to accept Heroku's self-signed certificate
        }
    },
    pool: {
        max: 80,
        min: 10,
        acquire: 30000,
        idle: 10000
    }
});

const Note = sequelize.define('Note', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    noteId: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    noteAuthorParticipantId: DataTypes.STRING,
    createdAtMillis: DataTypes.STRING,
    tweetId: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    classification: DataTypes.STRING,
    believable: DataTypes.STRING,
    harmful: DataTypes.STRING,
    validationDifficulty: DataTypes.STRING,
    misleadingOther: DataTypes.STRING,
    misleadingFactualError: DataTypes.STRING,
    misleadingManipulatedMedia: DataTypes.STRING,
    misleadingOutdatedInformation: DataTypes.STRING,
    misleadingMissingImportantContext: DataTypes.STRING,
    misleadingUnverifiedClaimAsFact: DataTypes.STRING,
    misleadingSatire: DataTypes.STRING,
    notMisleadingOther: DataTypes.STRING,
    notMisleadingFactuallyCorrect: DataTypes.STRING,
    notMisleadingOutdatedButNotWhenWritten: DataTypes.STRING,
    notMisleadingClearlySatire: DataTypes.STRING,
    notMisleadingPersonalOpinion: DataTypes.STRING,
    trustworthySources: DataTypes.STRING,
    summary: {
        type: DataTypes.STRING,
        allowNull: false
    },
    isMediaNote: DataTypes.STRING,
    handle: DataTypes.STRING,
    tweetText: DataTypes.STRING,
}, {
    tableName: 'notes',
    timestamps: false
});

const NoteStatus = sequelize.define('NoteStatus', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    noteId: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    noteAuthorParticipantId: DataTypes.STRING,
    createdAtMillis: DataTypes.STRING,
    timestampMillisOfFirstNonNMRStatus: DataTypes.STRING,
    firstNonNMRStatus: DataTypes.STRING,
    timestampMillisOfCurrentStatus: DataTypes.STRING,
    currentStatus: {
        type: DataTypes.STRING,
        allowNull: true
    },
    timestampMillisOfLatestNonNMRStatus: DataTypes.STRING,
    mostRecentNonNMRStatus: DataTypes.STRING,
    timestampMillisOfStatusLock: DataTypes.STRING,
    lockedStatus: DataTypes.STRING,
    timestampMillisOfRetroLock: DataTypes.STRING,
    currentCoreStatus: DataTypes.STRING,
    currentExpansionStatus: DataTypes.STRING,
    currentGroupStatus: DataTypes.STRING,
    currentDecidedBy: DataTypes.STRING,
    currentModelingGroup: DataTypes.STRING,
}, {
    tableName: 'note_status',
    timestamps: false
});

const User = sequelize.define('User', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true
    },
    handle: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    bio: {
        type: DataTypes.STRING,
        allowNull: true
    },
    profilePic: {
        type: DataTypes.STRING,
        allowNull: true
    },
    following: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    followers: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    subscriptions: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    location: {
        type: DataTypes.STRING,
        allowNull: true
    },
    website: {
        type: DataTypes.STRING,
        allowNull: true
    },
    joined: {
        type: DataTypes.STRING,
        allowNull: true
    },
    bannerPic: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: false
});

const NoteBackup = sequelize.define('NoteBackup', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    noteId: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    noteAuthorParticipantId: DataTypes.STRING,
    createdAtMillis: DataTypes.STRING,
    tweetId: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    classification: DataTypes.STRING,
    believable: DataTypes.STRING,
    harmful: DataTypes.STRING,
    validationDifficulty: DataTypes.STRING,
    misleadingOther: DataTypes.STRING,
    misleadingFactualError: DataTypes.STRING,
    misleadingManipulatedMedia: DataTypes.STRING,
    misleadingOutdatedInformation: DataTypes.STRING,
    misleadingMissingImportantContext: DataTypes.STRING,
    misleadingUnverifiedClaimAsFact: DataTypes.STRING,
    misleadingSatire: DataTypes.STRING,
    notMisleadingOther: DataTypes.STRING,
    notMisleadingFactuallyCorrect: DataTypes.STRING,
    notMisleadingOutdatedButNotWhenWritten: DataTypes.STRING,
    notMisleadingClearlySatire: DataTypes.STRING,
    notMisleadingPersonalOpinion: DataTypes.STRING,
    trustworthySources: DataTypes.STRING,
    summary: {
        type: DataTypes.STRING,
        allowNull: false
    },
    isMediaNote: DataTypes.STRING,
    handle: DataTypes.STRING,
    tweetText: DataTypes.STRING,
}, {
    tableName: 'notes_backup',
    timestamps: false
});

User.hasMany(Note, { foreignKey: 'handle', sourceKey: 'handle' });
Note.belongsTo(User, { foreignKey: 'handle', targetKey: 'handle' });

Note.hasOne(NoteStatus, { foreignKey: 'noteId', sourceKey: 'noteId' });
NoteStatus.belongsTo(Note, { foreignKey: 'noteId', targetKey: 'noteId' });

module.exports = {
    sequelize,
    Note,
    NoteStatus,
    User,
    NoteBackup,
};
