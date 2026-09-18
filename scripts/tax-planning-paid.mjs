#!/usr/bin/env node
/**
 * 个税筹划助手 Pro - 按量付费客户端脚本
 *
 * 实现 A2M 协议三步支付流程：
 *   probe    - 请求资源接口，获取 402 账单
 *   pay      - 调用 alipay-bot CLI 完成支付
 *   complete - 查询订单并获取资源结果
 *
 * 依赖：Node.js 18+、curl（系统 PATH 中）、alipay-bot（由 @alipay/agent-payment 提供）
 *
 * 用法：
 *   node scripts/tax-planning-paid.mjs probe --action tax-calc --income 300000 --social-insurance 3000 --state-dir .state/session1
 *   node scripts/tax-planning-paid.mjs pay --state-dir .state/session1 --session-id session1
 *   node scripts/tax-planning-paid.mjs complete --state-dir .state/session1 --out-shake-no PAY_xxx
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ──────────────────────────────────────────────────────

const RESOURCE_URL = 'https://am-server-tax-planning-pro.cn-hangzhou.fcapp.run/api/tax-planning';
const SERVICE_PRICE = '0.08';
const TIMEOUT_MS = 30000;

// ── 工具函数 ─────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else if (!args._) {
      args._ = argv[i];
    }
  }
  return args;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

// ─── probe：触发 402 账单 ─────────────────────────────────────

async function probe(args) {
  const stateDir = args['state-dir'] || '.state/default';
  await ensureDir(stateDir);

  const action = args.action || 'tax-calc';
  const body = { action };

  // 根据 action 收集参数
  if (args.income) body.income = parseFloat(args.income);
  if (args['social-insurance']) body.social_insurance = parseFloat(args['social-insurance']);
  if (args.deductions) body.deductions = parseFloat(args.deductions);
  if (args.bonus) body.bonus = parseFloat(args.bonus);
  if (args['bonus-method']) body.bonus_method = args['bonus-method'];
  if (args.other) body.other = parseFloat(args.other);
  // family-optimize
  if (args['income-a']) body.income_a = parseFloat(args['income-a']);
  if (args['income-b']) body.income_b = parseFloat(args['income-b']);
  if (args['insurance-a']) body.insurance_a = parseFloat(args['insurance-a']);
  if (args['insurance-b']) body.insurance_b = parseFloat(args['insurance-b']);
  if (args['children-education']) body.children_education = args['children-education'];
  if (args['housing-loan']) body.housing_loan = args['housing-loan'];
  if (args['housing-rent']) body.housing_rent = args['housing-rent'];
  if (args['elderly-care']) body.elderly_care = args['elderly-care'];
  // reconciliation
  if (args['annual-income']) body.annual_income = parseFloat(args['annual-income']);
  if (args['tax-paid']) body.tax_paid = parseFloat(args['tax-paid']);
  if (args['deductions-filled']) body.deductions_filled = args['deductions-filled'];
  // planning-strategy
  if (args.occupation) body.occupation = args.occupation;
  if (args.city) body.city = args.city;
  if (args['current-deductions']) body.current_deductions = parseFloat(args['current-deductions']);
  // tax-calendar
  if (args['current-month']) body.current_month = parseInt(args['current-month'], 10);
  if (args.focus) body.focus = args.focus;

  const bodyJson = JSON.stringify(body);
  const headerFile = join(stateDir, 'headers.txt');
  const bodyFile = join(stateDir, 'body.json');
  const paymentNeededFile = join(stateDir, 'payment-needed.txt');
  const requestMetaFile = join(stateDir, 'request-meta.json');

  // 使用 curl 发送请求，捕获响应头和响应体
  const curlArgs = [
    '-s', '-D', headerFile,
    '--connect-timeout', '10',
    '-o', bodyFile,
    '-w', 'HTTP_STATUS:%{http_code}',
    '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-d', bodyJson,
    RESOURCE_URL,
  ];

  const { stdout } = await execFileAsync('curl', curlArgs, { timeout: TIMEOUT_MS });
  const status = Number(stdout.match(/HTTP_STATUS:(\d+)/)?.[1] ?? 0);

  if (status === 200) {
    const resultBody = await readFile(bodyFile, 'utf-8');
    console.log('✅ 资源已就绪（HTTP 200）');
    console.log(resultBody);
    return { kind: 'resource', status, body: resultBody };
  }

  if (status !== 402) {
    throw new Error(`资源请求返回 HTTP ${status}，预期 402`);
  }

  // 从响应头提取 Payment-Needed
  const headersText = await readFile(headerFile, 'utf-8');
  const paymentNeededMatch = headersText.match(/payment-needed:\s*([^\r\n]+)/i);
  if (!paymentNeededMatch) {
    throw new Error('HTTP 402 但缺少 Payment-Needed 响应头');
  }
  const paymentNeeded = paymentNeededMatch[1].trim();

  // 保存状态文件
  await writeFile(paymentNeededFile, paymentNeeded, { encoding: 'utf8', mode: 0o600 });
  await writeFile(requestMetaFile, JSON.stringify({
    resourceUrl: RESOURCE_URL,
    method: 'POST',
    body,
    status,
    price: SERVICE_PRICE,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });

  // 解析账单信息
  const cleanPn = paymentNeeded.replace(/\s+/g, '');
  const padding = 4 - cleanPn.length % 4;
  const padded = padding !== 4 ? cleanPn + '='.repeat(padding) : cleanPn;
  const decoded = Buffer.from(padded, 'base64').toString('utf-8');
  let billInfo;
  try {
    billInfo = JSON.parse(decoded);
  } catch {
    billInfo = { raw: decoded };
  }

  const outTradeNo = billInfo?.protocol?.out_trade_no || '未知';
  const amount = billInfo?.protocol?.amount || SERVICE_PRICE;

  console.log('📋 需要支付');
  console.log(`   订单号: ${outTradeNo}`);
  console.log(`   金额: ¥${amount}`);
  console.log(`   服务: 个税筹划助手 Pro`);
  console.log('');
  console.log('下一步：运行 pay 命令完成支付');
  console.log(`   node scripts/tax-planning-paid.mjs pay --state-dir "${stateDir}" --session-id <SESSION_ID>`);

  return {
    kind: 'payment-needed',
    status,
    outTradeNo,
    amount,
    paymentNeededFile,
    stateDir,
  };
}

// ── pay：调用 alipay-bot 完成支付 ────────────────────────────

async function pay(args) {
  const stateDir = args['state-dir'] || '.state/default';
  const sessionId = args['session-id'];
  const paymentNeededFile = join(stateDir, 'payment-needed.txt');
  const requestMetaFile = join(stateDir, 'request-meta.json');

  const paymentNeeded = await readFile(paymentNeededFile, 'utf-8');
  const requestMeta = JSON.parse(await readFile(requestMetaFile, 'utf-8'));

  if (!sessionId) {
    throw new Error('缺少 --session-id 参数');
  }

  // 构建 alipay-bot 命令
  const botArgs = [
    '402-buyer-pay',
    '--session-id', sessionId,
    '--file', paymentNeededFile,
    '--resource-url', requestMeta.resourceUrl,
    '--method', requestMeta.method,
    '--intent-summary', `个税筹划助手 Pro - ${requestMeta.body.action || '未知操作'}`,
  ];

  // POST 请求需要传入请求体
  if (requestMeta.method === 'POST' && requestMeta.body) {
    const bodyFile = join(stateDir, 'request-body.json');
    await writeFile(bodyFile, JSON.stringify(requestMeta.body), { encoding: 'utf8' });
    botArgs.push('--body-file', bodyFile);
    botArgs.push('--content-type', 'application/json');
  }

  console.log('💳 正在调用 alipay-bot 发起支付...');
  console.log('   请在弹出的支付界面完成支付宝付款');
  console.log('');

  try {
    const { stdout, stderr } = await execFileAsync('alipay-bot', botArgs, {
      timeout: 300000,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    console.log('✅ 支付完成');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('未找到 alipay-bot 命令。请先安装：npx -y @alipay/agent-payment@latest install');
    }
    throw err;
  }
}

// ─── complete：查询订单并获取资源 ─────────────────────────────

async function complete(args) {
  const stateDir = args['state-dir'] || '.state/default';
  const outShakeNo = args['out-shake-no'];
  const requestMetaFile = join(stateDir, 'request-meta.json');

  if (!outShakeNo) {
    throw new Error('缺少 --out-shake-no 参数（订单号）');
  }

  const requestMeta = JSON.parse(await readFile(requestMetaFile, 'utf-8'));

  const botArgs = [
    '402-query-payment-status',
    '--out-shake-no', outShakeNo,
    '--resource-url', requestMeta.resourceUrl,
    '--method', requestMeta.method,
  ];

  if (requestMeta.method === 'POST' && requestMeta.body) {
    const bodyFile = join(stateDir, 'request-body.json');
    botArgs.push('--body-file', bodyFile);
    botArgs.push('--content-type', 'application/json');
  }

  console.log('🔄 查询订单并获取资源...');
  console.log('');

  try {
    const { stdout, stderr } = await execFileAsync('alipay-bot', botArgs, {
      timeout: TIMEOUT_MS,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('未找到 alipay-bot 命令。请先安装：npx -y @alipay/agent-payment@latest install');
    }
    throw err;
  }
}

// ── 主入口 ────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = args._;

try {
  switch (command) {
    case 'probe':
      await probe(args);
      break;
    case 'pay':
      await pay(args);
      break;
    case 'complete':
      await complete(args);
      break;
    default:
      console.log('个税筹划助手 Pro - 按量付费客户端');
      console.log('');
      console.log('用法:');
      console.log('  node scripts/tax-planning-paid.mjs probe --action <action> [options] --state-dir <dir>');
      console.log('  node scripts/tax-planning-paid.mjs pay --state-dir <dir> --session-id <id>');
      console.log('  node scripts/tax-planning-paid.mjs complete --state-dir <dir> --out-shake-no <order>');
      console.log('');
      console.log('操作类型 (action):');
      console.log('  tax-calc           个税精准计算');
      console.log('  family-optimize    家庭扣除分配优化');
      console.log('  reconciliation     汇算清缴退税指引');
      console.log('  planning-strategy  合法节税策略');
      console.log('  tax-calendar       税务日历');
      console.log('');
      console.log('示例:');
      console.log('  node scripts/tax-planning-paid.mjs probe --action tax-calc --income 300000 --social-insurance 3000 --state-dir .state/s1');
      console.log('  node scripts/tax-planning-paid.mjs pay --state-dir .state/s1 --session-id s1');
      console.log('  node scripts/tax-planning-paid.mjs complete --state-dir .state/s1 --out-shake-no PAY_xxx');
      process.exit(1);
  }
} catch (err) {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
}
