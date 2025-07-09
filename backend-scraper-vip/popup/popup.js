// 100fun 表格抓取工具 Pro - 弹出窗口控制脚本
// 版本: 2.0.0
// 日期: 2025-07-07
// 作者: 100fun

// 状态对象
let appState = {
  status: 'initializing',
  isRunning: false,
  isPeriodic: false,
  periodicInterval: 5
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
  console.log('弹出窗口初始化...');
  
  // 绑定按钮事件
  document.getElementById('startBtn').addEventListener('click', startScrape);
  document.getElementById('stopBtn').addEventListener('click', stopScrape);
  
  // 添加统一重置按钮事件
  document.getElementById('fullResetApp').addEventListener('click', fullResetApplication);
  
  // 周期性抓取设置
  const periodicSwitch = document.getElementById('togglePeriodicSwitch');
  periodicSwitch.addEventListener('change', togglePeriodicScrape);
  
  document.getElementById('periodicInterval').addEventListener('change', updatePeriodicInterval);
  
  // 获取当前状态
  getBackgroundState();
  
  // 定期刷新状态
  setInterval(getBackgroundState, 2000);
  
  addLog('弹出窗口已准备就绪', 'info');
});

// 获取后台脚本状态 - 增强版
function getBackgroundState() {
  console.log('[100fun] UI: 请求后台状态更新');
  
  chrome.runtime.sendMessage({action: 'getState'}, function(response) {
    if (response && response.success && response.state) {
      console.log('[100fun] UI: 收到后台状态更新');
      updateUI(response.state);
    } else {
      console.error('[100fun] UI: 获取状态失败:', response);
    }
  });
}

// 更新UI显示
function updateUI(state) {
  // 保存状态
  appState = state;
  
  // 更新状态文本
  const statusText = document.getElementById('statusText');
  statusText.className = 'status-text ' + state.status;
  
  // 根据状态设置文本
  switch (state.status) {
    case 'idle':
      statusText.textContent = '空闲 - 准备就绪';
      break;
    case 'scraping':
      statusText.textContent = '正在抓取第 ' + state.currentPage + ' 页...';
      break;
    case 'page_loading':
      statusText.textContent = '正在加载第 ' + state.currentPage + ' 页...';
      break;
    case 'navigating':
      statusText.textContent = '正在跳转到第 ' + state.currentPage + ' 页...';
      break;
    case 'completed':
      statusText.textContent = '抓取完成 - 共 ' + state.collectedPages + ' 页';
      break;
    case 'waiting':
      statusText.textContent = '等待下次抓取...';
      break;
    case 'error':
      statusText.textContent = '错误: ' + (state.error || '未知错误');
      break;
    case 'refreshing':
      statusText.textContent = '数据不是今天的，正在刷新页面...';
      break;
    default:
      statusText.textContent = state.status || '未知状态';
  }
  
  // 更新按钮状态
  document.getElementById('startBtn').disabled = state.isRunning;
  document.getElementById('stopBtn').disabled = !state.isRunning;
  
  // 更新提交状态
  if (state.submissionStats) {
    document.getElementById('submissionSuccess').textContent = state.submissionStats.success || 0;
    document.getElementById('submissionFailed').textContent = state.submissionStats.failed || 0;
  }
  
  // 更新周期性抓取设置
  document.getElementById('togglePeriodicSwitch').checked = state.isPeriodic;
  document.getElementById('periodicInterval').value = state.periodicInterval || 5;
  
  // 更新进度条
  const progressIndicator = document.getElementById('progressIndicator');
  if (state.isRunning || state.status === 'waiting') {
    progressIndicator.classList.remove('hidden');
    
    // 根据状态更新进度条文本
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');
    
    if (state.status === 'waiting' && state.nextScrapeTime) {
      // 计算倒计时
      const nextTime = new Date(state.nextScrapeTime);
      const now = new Date();
      const diffMs = nextTime - now;
      
      if (diffMs > 0) {
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        progressText.textContent = `等待下次抓取: ${diffMins}分${diffSecs}秒后`;
        
        // 计算等待进度
        const totalWaitMs = state.periodicInterval * 60000;
        const progress = 100 - (diffMs / totalWaitMs * 100);
        progressBar.style.width = `${progress}%`;
      } else {
        progressText.textContent = '准备开始新一轮抓取...';
        progressBar.style.width = '100%';
      }
    } else if (state.isRunning && state.totalPages > 0) {
      // 计算抓取进度
      const progress = (state.currentPage / state.totalPages) * 100;
      progressBar.style.width = `${progress}%`;
      progressText.textContent = `进度: ${state.currentPage} / ${state.totalPages} 页 (${Math.round(progress)}%)`;
    } else {
      progressText.textContent = '正在抓取数据...';
      // 使用不确定进度条动画
      progressBar.style.width = '100%';
      progressBar.style.animation = 'progress-bar-stripes 1s linear infinite';
    }
  } else {
    progressIndicator.classList.add('hidden');
  }
  
  // 更新数据统计
  document.getElementById('totalRecords').textContent = state.totalRecords || '-';
  document.getElementById('totalPages').textContent = state.totalPages || '-';
  document.getElementById('currentPage').textContent = state.currentPage || '-';
  document.getElementById('collectedPages').textContent = state.collectedPages || '0';
  document.getElementById('currentRound').textContent = state.currentRound || '1';
  
  if (state.nextScrapeTime) {
    const nextTime = new Date(state.nextScrapeTime);
    document.getElementById('nextScrapeTime').textContent = nextTime.toLocaleTimeString();
  } else {
    document.getElementById('nextScrapeTime').textContent = '-';
  }
  
  // 更新最后更新时间
  document.getElementById('lastUpdate').textContent = '最后更新: ' + new Date().toLocaleTimeString();
}

// 开始抓取
function startScrape() {
  addLog('正在启动抓取任务...', 'info');
  
  chrome.runtime.sendMessage({action: 'startScrape'}, function(response) {
    if (response && response.success) {
      addLog(response.message, 'success');
      getBackgroundState(); // 刷新状态
    } else {
      const errorMsg = response ? response.message : '未收到有效响应';
      addLog('启动失败: ' + errorMsg, 'error');
    }
  });
}

// 停止抓取
function stopScrape() {
  addLog('正在停止抓取任务...', 'info');
  
  chrome.runtime.sendMessage({action: 'stopScrape'}, function(response) {
    if (response && response.success) {
      addLog(response.message, 'success');
      getBackgroundState(); // 刷新状态
    } else {
      const errorMsg = response ? response.message : '未收到有效响应';
      addLog('停止失败: ' + errorMsg, 'error');
    }
  });
}

// 切换周期性抓取
function togglePeriodicScrape() {
  const isChecked = document.getElementById('togglePeriodicSwitch').checked;
  const interval = parseInt(document.getElementById('periodicInterval').value) || 5;
  
  console.log(`[100fun] UI: 尝试${isChecked ? '启用' : '禁用'}周期性抓取`);
  addLog((isChecked ? '启用' : '禁用') + '周期性抓取...', 'info');
  
  // 禁用开关，防止重复点击
  document.getElementById('togglePeriodicSwitch').disabled = true;
  
  // 发送命令到后台
  chrome.runtime.sendMessage({
    action: 'togglePeriodic',
    enabled: isChecked,
    interval: interval
  }, function(response) {
    // 启用开关
    document.getElementById('togglePeriodicSwitch').disabled = false;
    
    // 处理响应
    if (response && response.success) {
      addLog(response.message, 'success');
      console.log('[100fun] UI: 切换周期性抓取成功');
      
      // 立即刷新状态
      setTimeout(getBackgroundState, 200);
    } else {
      const errMsg = response ? response.message : '未收到有效响应';
      addLog('切换周期性抓取失败: ' + errMsg, 'error');
      console.error('[100fun] UI: 切换周期性抓取失败:', errMsg);
      
      // 恢复原始状态
      document.getElementById('togglePeriodicSwitch').checked = appState.isPeriodic;
    }
  });
}

// 更新周期间隔
function updatePeriodicInterval() {
  const intervalInput = document.getElementById('periodicInterval');
  let value = parseInt(intervalInput.value);
  
  // 验证范围
  if (isNaN(value) || value < 1) {
    value = 1;
    intervalInput.value = 1;
  } else if (value > 60) {
    value = 60;
    intervalInput.value = 60;
  }
  
  console.log(`[100fun] UI: 尝试更新周期间隔为 ${value} 分钟`);
  addLog(`更新周期间隔为 ${value} 分钟...`, 'info');
  
  // 发送命令到后台
  chrome.runtime.sendMessage({
    action: 'updateInterval',
    interval: value
  }, function(response) {
    // 处理响应
    if (response && response.success) {
      addLog('更新周期间隔成功', 'success');
      console.log('[100fun] UI: 更新周期间隔成功');
      
      // 立即刷新状态
      setTimeout(getBackgroundState, 200);
    } else {
      const errMsg = response ? response.message : '未收到有效响应';
      addLog('更新周期间隔失败: ' + errMsg, 'error');
      console.error('[100fun] UI: 更新周期间隔失败:', errMsg);
    }
  });
}

// 添加统一重置功能
function fullResetApplication() {
  if (confirm('确定要重置插件吗？\n\n这将:\n- 停止所有抓取任务\n- 禁用周期性抓取\n- 清除所有数据\n- 恢复初始状态\n- 重新加载扩展\n\n此操作不可撤销!')) {
    addLog('正在重置插件...', 'warning');
    
    chrome.runtime.sendMessage({action: 'fullResetApplication'}, function(response) {
      if (response && response.success) {
        addLog(response.message, 'success');
        
        // 显示重置成功消息
        const statusText = document.getElementById('statusText');
        statusText.textContent = '插件正在重置...';
        statusText.className = 'status-text waiting';
        
        // 更新界面，显示加载动画
        const progressIndicator = document.getElementById('progressIndicator');
        progressIndicator.classList.remove('hidden');
        const progressText = document.getElementById('progressText');
        progressText.textContent = '重置中，请稍候...';
        
        // 禁用所有按钮
        const allButtons = document.querySelectorAll('button');
        allButtons.forEach(btn => btn.disabled = true);
        
        // 等待1秒后重新加载扩展
        setTimeout(() => {
          chrome.runtime.reload();
        }, 1000);
      } else {
        const errMsg = response ? response.message : '未收到有效响应';
        addLog('重置插件失败: ' + errMsg, 'error');
      }
    });
  }
}

// 添加日志
function addLog(message, type = 'info') {
  const logArea = document.getElementById('logArea');
  const time = new Date().toTimeString().split(' ')[0];
  
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  logEntry.textContent = `[${time}] ${message}`;
  
  logArea.appendChild(logEntry);
  logArea.scrollTop = logArea.scrollHeight;
  
  // 限制日志条目数量
  if (logArea.children.length > 100) {
    logArea.removeChild(logArea.children[0]);
  }
}

// 监听来自后台的消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'stateUpdated' || message.type === 'STATE_UPDATED') {
    // 更新UI
    updateUI(message.state || message.payload);
  }
});

console.log('100fun 表格抓取工具 Pro 弹出窗口脚本已加载');
