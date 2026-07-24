/**
 * 新中智查后端 API
 * 部署在 Vercel Serverless Functions
 * 数据库：MongoDB Atlas (免费 512MB)
 *
 * 环境变量（在 Vercel 后台设置）：
 *   MONGODB_URI  - MongoDB Atlas 连接字符串
 *   WX_APPID     - 小程序 AppID
 *   WX_SECRET    - 小程序 AppSecret
 */

const { MongoClient, ObjectId } = require('mongodb')

// ===== MongoDB 连接（利用全局缓存避免每次请求重新连接）=====
let cachedClient = null
let cachedDb = null

async function getDb() {
  if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
    return cachedDb
  }
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI 环境变量未设置')
  cachedClient = new MongoClient(uri, {
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    serverSelectionTimeoutMS: 5000
  })
  await cachedClient.connect()
  cachedDb = cachedClient.db('xinzhi-query')
  return cachedDb
}

// ===== 工具函数 =====
function cleanDoc(doc) {
  if (!doc) return null
  const o = { ...doc }
  if (o._id) {
    o.id = String(o._id)
    delete o._id
  }
  return o
}

function cleanDocs(docs) {
  return (docs || []).map(cleanDoc)
}

// ===== 微信登录：code 换 openid =====
async function code2openid(code) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) throw new Error('WX_APPID/WX_SECRET 环境变量未设置')

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
  const https = require('https')

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.openid) {
            resolve(result.openid)
          } else {
            reject(new Error(result.errmsg || '微信登录失败'))
          }
        } catch (e) {
          reject(new Error('微信登录响应解析失败'))
        }
      })
    }).on('error', (e) => {
      reject(new Error('微信登录请求失败: ' + e.message))
    })
  })
}

// ===== 常量 =====
const MAX_PROJECTS_PER_TEACHER = 10
const MAX_ACTIVITIES_PER_TEACHER = 10

// ===== 主处理函数 =====
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  // GET 请求返回健康检查
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, message: '新中智查 API 运行中', time: Date.now() })
  }

  const body = req.body || {}
  const action = body.action

  if (!action) {
    return res.status(400).json({ success: false, message: '缺少 action 参数' })
  }

  try {
    const db = await getDb()
    let result

    switch (action) {
      // ===== 微信登录 =====
      case 'wxLogin':
        result = await handleWxLogin(db, body)
        break

      // ===== 读取接口（原 wx.cloud.database 客户端直读） =====
      case 'getTeachers':
        result = await handleGetCollection(db, 'teachers', { sortBy: 'createdAt', sortOrder: -1 })
        break
      case 'getStudents':
        result = await handleGetCollection(db, 'students', { sortBy: 'createdAt', sortOrder: -1 })
        break
      case 'getProjects':
        result = await handleGetCollection(db, 'projects', { sortBy: 'createdAt', sortOrder: -1 })
        break
      case 'getActivities':
        result = await handleGetCollection(db, 'activities', { sortBy: 'createdAt', sortOrder: -1 })
        break
      case 'getRecords':
        result = await handleGetCollection(db, 'records', { sortBy: 'queriedAt', sortOrder: -1 })
        break

      // ===== 登录 =====
      case 'login':
        result = await handleLogin(db, body)
        break

      // ===== 初始化种子数据 =====
      case 'initData':
        result = await handleInitData(db)
        break

      // ===== 教师操作 =====
      case 'addTeacher':
        result = await handleAddTeacher(db, body)
        break
      case 'deleteTeacher':
        result = await handleDeleteTeacher(db, body)
        break
      case 'deleteTeachers':
        result = await handleDeleteTeachers(db, body)
        break
      case 'deleteAllTeachers':
        result = await handleDeleteAllTeachers(db)
        break
      case 'resetTeacherPassword':
        result = await handleResetTeacherPassword(db, body)
        break
      case 'batchAddTeachers':
        result = await handleBatchAddTeachers(db, body)
        break

      // ===== 学生操作 =====
      case 'addStudent':
        result = await handleAddStudent(db, body)
        break
      case 'deleteStudent':
        result = await handleDeleteStudent(db, body)
        break
      case 'deleteStudents':
        result = await handleDeleteStudents(db, body)
        break
      case 'deleteAllStudents':
        result = await handleDeleteAllStudents(db)
        break
      case 'batchAddStudents':
        result = await handleBatchAddStudents(db, body)
        break
      case 'batchUpsertStudents':
        result = await handleBatchUpsertStudents(db, body)
        break

      // ===== 项目操作 =====
      case 'addProject':
        result = await handleAddProject(db, body)
        break
      case 'deleteProject':
        result = await handleDeleteProject(db, body)
        break
      case 'togglePinProject':
        result = await handleTogglePinProject(db, body)
        break
      case 'countTeacherProjects':
        result = await handleCountTeacherProjects(db, body)
        break

      // ===== 接龙活动 =====
      case 'addActivity':
        result = await handleAddActivity(db, body)
        break
      case 'deleteActivity':
        result = await handleDeleteActivity(db, body)
        break
      case 'joinActivity':
        result = await handleJoinActivity(db, body)
        break
      case 'countTeacherActivities':
        result = await handleCountTeacherActivities(db, body)
        break

      // ===== 记录操作 =====
      case 'addRecord':
        result = await handleAddRecord(db, body)
        break
      case 'deleteRecord':
        result = await handleDeleteRecord(db, body)
        break
      case 'deleteRecords':
        result = await handleDeleteRecords(db, body)
        break
      case 'clearRecords':
        result = await handleClearRecords(db, body)
        break

      // ===== 家长微信绑定 =====
      case 'getParentBinding':
        result = await handleGetParentBinding(db, body)
        break
      case 'saveParentBinding':
        result = await handleSaveParentBinding(db, body)
        break
      case 'clearParentBinding':
        result = await handleClearParentBinding(db, body)
        break

      // ===== 教师微信绑定 =====
      case 'getTeacherBinding':
        result = await handleGetTeacherBinding(db, body)
        break
      case 'saveTeacherBinding':
        result = await handleSaveTeacherBinding(db, body)
        break
      case 'clearTeacherBinding':
        result = await handleClearTeacherBinding(db, body)
        break

      default:
        result = { success: false, message: '未知操作: ' + action }
    }

    return res.status(200).json(result)
  } catch (e) {
    console.error('API error:', action, e.message)
    return res.status(200).json({ success: false, message: e.message || '服务器错误' })
  }
}

// ===== 通用：获取集合数据 =====
async function handleGetCollection(db, collectionName, options) {
  const sortBy = options.sortBy || 'createdAt'
  const sortOrder = options.sortOrder === 1 ? 1 : -1
  const docs = await db.collection(collectionName)
    .find({})
    .sort({ [sortBy]: sortOrder })
    .limit(1000)
    .toArray()
  return { success: true, data: cleanDocs(docs) }
}

// ===== 微信登录：code 换 openid =====
async function handleWxLogin(db, body) {
  const code = body.code
  if (!code) return { success: false, message: '缺少 code' }
  const openid = await code2openid(code)
  return { success: true, data: { openid } }
}

// ===== 登录 =====
async function handleLogin(db, body) {
  const role = body.role

  if (role === 'teacher') {
    const phone = body.phone
    const password = body.password
    const teachers = await db.collection('teachers').find({ phone, password }).limit(1).toArray()
    if (teachers.length > 0) {
      return { success: true, data: cleanDoc(teachers[0]) }
    }
    return { success: false, message: '手机号或密码错误' }
  }

  if (role === 'admin') {
    if (body.adminId === 'admin' && body.adminPassword === 'admin123') {
      return { success: true, data: { adminId: 'admin', name: '系统管理员', role: '校方管理员' } }
    }
    return { success: false, message: '管理员账号或密码错误' }
  }

  return { success: false, message: '未知角色' }
}

// ===== 初始化种子数据 =====
async function handleInitData(db) {
  const existing = await db.collection('teachers').countDocuments()
  if (existing > 0) {
    return { success: true, message: '数据已存在，跳过初始化' }
  }

  const now = Date.now()

  const teachers = [
    { name: '张老师', phone: '13800000001', password: '000001', subject: '物理', className: '高三(1)班', createdAt: now },
    { name: '李老师', phone: '13800000002', password: '000002', subject: '数学', className: '高三(2)班', createdAt: now }
  ]
  await db.collection('teachers').insertMany(teachers)

  const students = [
    { name: '王明', idCard: '440301200501011234', className: '高三(1)班', createdAt: now },
    { name: '李华', idCard: '440301200502022345', className: '高三(1)班', createdAt: now },
    { name: '陈晓', idCard: '440301200503033456', className: '高三(2)班', createdAt: now },
    { name: '刘洋', idCard: '44030120050404456X', className: '高三(2)班', createdAt: now }
  ]
  await db.collection('students').insertMany(students)

  const projects = [
    {
      title: '高三第一次月考成绩',
      teacherId: '',
      teacherName: '张老师',
      className: '',
      createdAt: now - 3 * 24 * 60 * 60 * 1000,
      isPinned: true,
      isPublished: true,
      columns: ['语文', '数学', '英语', '物理', '化学'],
      data: [
        { name: '王明', idCard: '440301200501011234', values: { '语文': 118, '数学': 135, '英语': 128, '物理': 92, '化学': 88 } },
        { name: '李华', idCard: '440301200502022345', values: { '语文': 110, '数学': 142, '英语': 115, '物理': 85, '化学': 90 } },
        { name: '陈晓', idCard: '440301200503033456', values: { '语文': 125, '数学': 128, '英语': 132, '物理': 95, '化学': 92 } },
        { name: '刘洋', idCard: '44030120050404456X', values: { '语文': 105, '数学': 120, '英语': 108, '物理': 78, '化学': 82 } }
      ]
    },
    {
      title: '物理周测（第8周）',
      teacherId: '',
      teacherName: '张老师',
      className: '',
      createdAt: now - 1 * 24 * 60 * 60 * 1000,
      isPinned: false,
      isPublished: true,
      columns: ['成绩', '排名'],
      data: [
        { name: '王明', idCard: '440301200501011234', values: { '成绩': 92, '排名': 5 } },
        { name: '李华', idCard: '440301200502022345', values: { '成绩': 85, '排名': 18 } },
        { name: '陈晓', idCard: '440301200503033456', values: { '成绩': 95, '排名': 2 } },
        { name: '刘洋', idCard: '44030120050404456X', values: { '成绩': 78, '排名': 25 } }
      ]
    }
  ]
  await db.collection('projects').insertMany(projects)

  const records = [
    { projectId: '', projectTitle: '高三第一次月考成绩', studentName: '王明', relationship: '妈妈', queriedAt: now - 2 * 60 * 60 * 1000 },
    { projectId: '', projectTitle: '高三第一次月考成绩', studentName: '陈晓', relationship: '爸爸', queriedAt: now - 1 * 60 * 60 * 1000 }
  ]
  await db.collection('records').insertMany(records)

  return { success: true, message: '初始化完成，已创建 ' + teachers.length + ' 名教师、' + students.length + ' 名学生、' + projects.length + ' 个项目' }
}

// ===== 教师操作 =====
async function handleAddTeacher(db, body) {
  const teacher = {
    name: body.name,
    phone: body.phone,
    password: body.phone ? body.phone.slice(-6) : '123456',
    subject: body.subject || '',
    className: body.className || '',
    createdAt: Date.now()
  }
  const result = await db.collection('teachers').insertOne(teacher)
  teacher.id = String(result.insertedId)
  return { success: true, data: teacher }
}

async function handleDeleteTeacher(db, body) {
  await db.collection('teachers').deleteOne({ _id: new ObjectId(body.id) })
  return { success: true }
}

async function handleDeleteTeachers(db, body) {
  const ids = (body.ids || []).map(id => new ObjectId(id))
  const result = await db.collection('teachers').deleteMany({ _id: { $in: ids } })
  return { success: true, removed: result.deletedCount }
}

async function handleDeleteAllTeachers(db) {
  const result = await db.collection('teachers').deleteMany({})
  return { success: true, removed: result.deletedCount }
}

async function handleResetTeacherPassword(db, body) {
  await db.collection('teachers').updateOne(
    { _id: new ObjectId(body.id) },
    { $set: { password: body.password } }
  )
  return { success: true }
}

async function handleBatchAddTeachers(db, body) {
  const now = Date.now()
  const items = (body.teachers || []).map(t => ({
    name: t.name,
    phone: t.phone,
    password: t.phone ? t.phone.slice(-6) : '123456',
    subject: t.subject || '',
    className: t.className || '',
    createdAt: now
  }))
  if (items.length === 0) return { success: true, added: 0 }
  const result = await db.collection('teachers').insertMany(items)
  return { success: true, added: result.insertedCount }
}

// ===== 学生操作 =====
async function handleAddStudent(db, body) {
  const student = {
    name: body.name,
    idCard: (body.idCard || '').toUpperCase(),
    className: body.className || '',
    createdAt: Date.now()
  }
  const result = await db.collection('students').insertOne(student)
  student.id = String(result.insertedId)
  return { success: true, data: student }
}

async function handleDeleteStudent(db, body) {
  await db.collection('students').deleteOne({ _id: new ObjectId(body.id) })
  return { success: true }
}

async function handleDeleteStudents(db, body) {
  const ids = (body.ids || []).map(id => new ObjectId(id))
  const result = await db.collection('students').deleteMany({ _id: { $in: ids } })
  return { success: true, removed: result.deletedCount }
}

async function handleDeleteAllStudents(db) {
  const result = await db.collection('students').deleteMany({})
  return { success: true, removed: result.deletedCount }
}

async function handleBatchAddStudents(db, body) {
  const now = Date.now()
  const items = (body.students || []).map(s => ({
    name: s.name,
    idCard: (s.idCard || '').toUpperCase(),
    className: s.className || '',
    createdAt: now
  }))
  if (items.length === 0) return { success: true, added: 0 }
  const result = await db.collection('students').insertMany(items)
  return { success: true, added: result.insertedCount }
}

async function handleBatchUpsertStudents(db, body) {
  const now = Date.now()
  let added = 0
  let updated = 0

  for (const s of (body.students || [])) {
    const idCard = (s.idCard || '').toUpperCase()
    if (!s.name || !idCard) continue

    const existing = await db.collection('students').findOne({ idCard })
    if (existing) {
      await db.collection('students').updateOne(
        { _id: existing._id },
        { $set: { name: s.name, className: s.className || existing.className } }
      )
      updated++
    } else {
      await db.collection('students').insertOne({
        name: s.name,
        idCard: idCard,
        className: s.className || '',
        createdAt: now
      })
      added++
    }
  }

  return { success: true, added, updated }
}

// ===== 项目操作 =====
async function handleAddProject(db, body) {
  if (body.teacherId || body.teacherName) {
    const count = await db.collection('projects').countDocuments({
      $or: [
        { teacherId: body.teacherId || '__none__' },
        { teacherName: body.teacherName || '__none__' }
      ]
    })
    if (count >= MAX_PROJECTS_PER_TEACHER) {
      return { success: false, message: '每位老师最多只能创建 ' + MAX_PROJECTS_PER_TEACHER + ' 个查询项目，请先删除一些旧项目' }
    }
  }

  const project = {
    title: body.title || '',
    teacherId: body.teacherId || '',
    teacherName: body.teacherName || '',
    className: body.className || '',
    createdAt: Date.now(),
    isPinned: false,
    isPublished: true,
    columns: body.columns || [],
    data: body.data || []
  }
  const result = await db.collection('projects').insertOne(project)
  project.id = String(result.insertedId)
  return { success: true, data: project }
}

async function handleDeleteProject(db, body) {
  await db.collection('projects').deleteOne({ _id: new ObjectId(body.id) })
  return { success: true }
}

async function handleTogglePinProject(db, body) {
  const project = await db.collection('projects').findOne({ _id: new ObjectId(body.id) })
  if (!project) return { success: false, message: '项目不存在' }
  const newPinned = !project.isPinned
  await db.collection('projects').updateOne(
    { _id: new ObjectId(body.id) },
    { $set: { isPinned: newPinned } }
  )
  return { success: true, isPinned: newPinned }
}

async function handleCountTeacherProjects(db, body) {
  const count = await db.collection('projects').countDocuments({
    $or: [
      { teacherId: body.teacherId || '__none__' },
      { teacherName: body.teacherName || '__none__' }
    ]
  })
  return { success: true, count, max: MAX_PROJECTS_PER_TEACHER }
}

// ===== 接龙活动 =====
async function handleAddActivity(db, body) {
  if (body.teacherId || body.teacherName) {
    const count = await db.collection('activities').countDocuments({
      $or: [
        { teacherId: body.teacherId || '__none__' },
        { teacherName: body.teacherName || '__none__' }
      ]
    })
    if (count >= MAX_ACTIVITIES_PER_TEACHER) {
      return { success: false, message: '每位老师最多只能创建 ' + MAX_ACTIVITIES_PER_TEACHER + ' 个接龙活动，请先删除一些旧活动' }
    }
  }

  const activity = {
    title: body.title || '',
    content: body.content || '',
    images: body.images || [],
    teacherId: body.teacherId || '',
    teacherName: body.teacherName || '',
    className: body.className || '',
    deadline: body.deadline || '',
    status: 'active',
    joined: [],
    createdAt: Date.now()
  }
  const result = await db.collection('activities').insertOne(activity)
  activity.id = String(result.insertedId)
  return { success: true, data: activity }
}

async function handleDeleteActivity(db, body) {
  await db.collection('activities').deleteOne({ _id: new ObjectId(body.id) })
  return { success: true }
}

async function handleJoinActivity(db, body) {
  const activity = await db.collection('activities').findOne({ _id: new ObjectId(body.activityId) })
  if (!activity) return { success: false, message: '活动不存在' }

  const joined = activity.joined || []
  const joinData = body.joinData || {}
  const exists = joined.find(j => j.name === joinData.name && j.relationship === joinData.relationship)
  if (exists) return { success: false, message: '您已经参与过此活动' }

  joined.push({ ...joinData, joinedAt: Date.now() })
  await db.collection('activities').updateOne(
    { _id: new ObjectId(body.activityId) },
    { $set: { joined } }
  )
  return { success: true }
}

async function handleCountTeacherActivities(db, body) {
  const count = await db.collection('activities').countDocuments({
    $or: [
      { teacherId: body.teacherId || '__none__' },
      { teacherName: body.teacherName || '__none__' }
    ]
  })
  return { success: true, count, max: MAX_ACTIVITIES_PER_TEACHER }
}

// ===== 记录操作 =====
async function handleAddRecord(db, body) {
  const record = {
    projectId: body.projectId || '',
    projectTitle: body.projectTitle || '',
    studentName: body.studentName || '',
    relationship: body.relationship || '',
    queriedAt: Date.now()
  }
  const result = await db.collection('records').insertOne(record)
  record.id = String(result.insertedId)
  return { success: true, data: record }
}

async function handleDeleteRecord(db, body) {
  await db.collection('records').deleteOne({ _id: new ObjectId(body.id) })
  return { success: true }
}

async function handleDeleteRecords(db, body) {
  const ids = (body.ids || []).map(id => new ObjectId(id))
  const result = await db.collection('records').deleteMany({ _id: { $in: ids } })
  return { success: true, removed: result.deletedCount }
}

async function handleClearRecords(db, body) {
  const filter = body.projectId ? { projectId: body.projectId } : {}
  const result = await db.collection('records').deleteMany(filter)
  return { success: true, removed: result.deletedCount }
}

// ===== 家长微信绑定 =====
async function handleGetParentBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  const binding = await db.collection('parent_bindings').findOne({ _openid: openid })
  return { success: true, data: binding ? cleanDoc(binding) : null }
}

async function handleSaveParentBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  const binding = body.binding || {}
  binding._openid = openid
  binding.updatedAt = Date.now()
  if (!binding.createdAt) binding.createdAt = Date.now()

  // 删除旧绑定（同一 openid 只允许一个绑定）
  await db.collection('parent_bindings').deleteMany({ _openid: openid })
  const result = await db.collection('parent_bindings').insertOne(binding)
  return { success: true, data: { ...binding, id: String(result.insertedId) } }
}

async function handleClearParentBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  await db.collection('parent_bindings').deleteMany({ _openid: openid })
  return { success: true }
}

// ===== 教师微信绑定 =====
async function handleGetTeacherBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  const binding = await db.collection('teacher_bindings').findOne({ _openid: openid })
  return { success: true, data: binding ? cleanDoc(binding) : null }
}

async function handleSaveTeacherBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  const binding = body.binding || {}
  binding._openid = openid
  binding.updatedAt = Date.now()
  if (!binding.createdAt) binding.createdAt = Date.now()

  await db.collection('teacher_bindings').deleteMany({ _openid: openid })
  const result = await db.collection('teacher_bindings').insertOne(binding)
  return { success: true, data: { ...binding, id: String(result.insertedId) } }
}

async function handleClearTeacherBinding(db, body) {
  const openid = body._openid
  if (!openid) return { success: false, message: '未登录' }
  await db.collection('teacher_bindings').deleteMany({ _openid: openid })
  return { success: true }
}
