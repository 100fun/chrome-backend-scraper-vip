/**
 * 100fun 表格抓取工具 Pro - 后台服务脚本
 * 版本: 2.0.0
 * 日期: 2025-07-07
 * 作者: 100fun
 */

// 全局状态对象
let scrapeState = {
  isRunning: false,          // 是否正在运行抓取任务
  isPeriodic: false,         // 是否启用周期性抓取
  targetTabId: null,         // 目标标签页ID
  currentPage: 1,            // 当前页码
  totalPages: 0,             // 总页数
  totalRecords: 0,           // 总记录数
  collectedPages: 0,         // 已收集的页数
  periodicInterval: 5,       // 周期间隔(分钟)
  lastScrapeTime: null,      // 上次抓取时间
  nextScrapeTime: null,      // 下次抓取时间
  allPagesData: [],          // 所有页面数据
  currentRound: 1,           // 当前抓取轮次
  status: 'idle',            // 当前状态: idle, scraping, waiting, error
  error: null,               // 错误信息
  submissionStats: {         // 提交数据统计
    success: 0,
    failed: 0
  }
};

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[100fun] 后台服务初始化');
  
  // 从存储中恢复状态
  try {
    const result = await chrome.storage.local.get('scrapeState');
    if (result.scrapeState) {
      // 恢复部分状态，但默认设置为非运行状态
      const savedState = result.scrapeState;
      scrapeState.isPeriodic = savedState.isPeriodic;
      scrapeState.periodicInterval = savedState.periodicInterval;
      scrapeState.allPagesData = savedState.allPagesData || [];
      scrapeState.lastScrapeTime = savedState.lastScrapeTime;
      scrapeState.currentRound = savedState.currentRound || 1;
      scrapeState.submissionStats = savedState.submissionStats || { success: 0, failed: 0 };
      
      // 重置运行状态
      scrapeState.isRunning = false;
      scrapeState.status = 'idle';
      
      // 设置报警器，如果需要
      if (savedState.isPeriodic && savedState.nextScrapeTime) {
        const now = Date.now();
        const nextTime = new Date(savedState.nextScrapeTime).getTime();
        if (nextTime > now) {
          setupPeriodicAlarm((nextTime - now) / 60000); // 转换为分钟
        }
      }
    }
  } catch (err) {
    console.error('[100fun] 恢复状态失败:', err);
  }
  
  // 保存初始状态
  await saveState();
});

// 设置周期性报警 - 修复版
function setupPeriodicAlarm(minutesFromNow) {
  try {
    // 清除现有报警
    chrome.alarms.clear("periodicScrape", (wasCleared) => {
      console.log(`[100fun] 清除现有报警: ${wasCleared ? '成功' : '无需清除'}`);
      
      // 创建新报警
      chrome.alarms.create("periodicScrape", {
        delayInMinutes: minutesFromNow
      });
      
      // 更新下次抓取时间
      const nextTime = new Date();
      nextTime.setMinutes(nextTime.getMinutes() + minutesFromNow);
      
      // 更新状态
      scrapeState.nextScrapeTime = nextTime.toISOString();
      saveState();
      
      console.log(`[100fun] 设置周期性报警: ${minutesFromNow} 分钟后，时间: ${nextTime.toLocaleString()}`);
    });
  } catch (err) {
    console.error('[100fun] 设置报警器失败:', err);
  }
}

// 监听报警事件
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "periodicScrape") {
    console.log('[100fun] 周期性报警触发，开始新一轮抓取');
    if (scrapeState.isPeriodic && !scrapeState.isRunning) {
      startNewScrapeRound();
    }
  }
});

// 保存状态到存储
async function saveState() {
  try {
    await chrome.storage.local.set({scrapeState: scrapeState});
    console.log('[100fun] 状态已保存');
  } catch (err) {
    console.error('[100fun] 保存状态失败:', err);
  }
}

// 统一的状态更新函数
function updateState(changes) {
  // 更新本地状态
  Object.assign(scrapeState, changes);
  
  // 存储到持久化存储
  chrome.storage.local.set({ scrapeState });
  
  // 发送消息通知所有页面更新UI
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATED',
    payload: scrapeState
  });
  
  // 向所有标签页广播更新
  chrome.tabs.query({}, function(tabs) {
    for (let tab of tabs) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'STATE_UPDATED',
          payload: scrapeState
        }).catch(() => {
          // 忽略页面未监听的错误
        });
      } catch (e) {
        // 忽略无法发送的错误
      }
    }
  });
  
  console.log('[100fun] 状态已更新:', changes);
}

// 开始一轮新的抓取
async function startNewScrapeRound() {
  try {
    // 检查是否有目标标签页
    if (!scrapeState.targetTabId) {
      // 获取当前活动标签页
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs.length === 0) {
        throw new Error('找不到活动标签页');
      }
      scrapeState.targetTabId = tabs[0].id;
    }
    
    // 重置抓取状态
    await updateState({
      isRunning: true,
      status: 'scraping',
      currentPage: 1,
      collectedPages: 0,
      allPagesData: [],
      error: null,
      lastScrapeTime: new Date().toISOString()
    });
    
    console.log(`[100fun] 开始第 ${scrapeState.currentRound} 轮抓取任务`);
    
    // 首先点击查询按钮
    await clickQueryButton();
    
    // 点击成功后延迟一段时间再开始抓取
    setTimeout(() => scrapeCurrentPage(), 1500);
    
  } catch (err) {
    handleError(`启动抓取任务失败: ${err.message}`);
  }
}

// 点击查询按钮
async function clickQueryButton() {
  try {
    console.log(`[100fun] 尝试点击查询按钮，标签页ID: ${scrapeState.targetTabId}`);
    
    const results = await chrome.scripting.executeScript({
      target: {tabId: scrapeState.targetTabId},
      func: () => {
        try {
          // 方法1：尝试找到包含"查询"文本的按钮
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const btn of buttons) {
            if (btn.textContent.includes('查询') || btn.textContent.includes('立即查询')) {
              btn.click();
              return {success: true, message: '找到并点击了包含"查询"的按钮'};
            }
          }
          
          // 方法2：尝试找到primary按钮
          const primaryButtons = document.querySelectorAll('button.el-button--primary');
          if (primaryButtons.length > 0) {
            primaryButtons[0].click();
            return {success: true, message: '点击了第一个primary按钮'};
          }
          
          return {success: false, message: '未找到可点击的按钮'};
        } catch (e) {
          return {success: false, message: '执行点击出错: ' + e.message};
        }
      }
    });
    
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      if (result.success) {
        console.log(`[100fun] 点击查询按钮成功: ${result.message}`);
        return true;
      } else {
        throw new Error(`点击查询按钮失败: ${result.message}`);
      }
    } else {
      throw new Error('执行查询点击脚本失败');
    }
  } catch (err) {
    console.error(`[100fun] 点击查询按钮出错:`, err);
    throw err;
  }
}

// 提交页面数据到服务器
async function submitPageDataToServer(pageData) {
  try {
    console.log(`[100fun] 准备提交第 ${scrapeState.currentPage} 页数据到服务器`);
    
    // 记录详细日志
    console.log('[100fun] 提交URL:', 'https://hskg.vivemall.com/scraper_vip.php');
    console.log('[100fun] 数据行数:', pageData.rows ? pageData.rows.length : 0);
    
    // 提交数据
    const response = await fetch('https://hskg.vivemall.com/scraper_vip.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        pageNumber: scrapeState.currentPage,
        pageData: pageData
      })
    });
    
    // 记录响应状态
    console.log(`[100fun] 服务器响应状态: ${response.status} ${response.statusText}`);
    
    // 获取原始响应文本
    const responseText = await response.text();
    console.log(`[100fun] 服务器响应内容: ${responseText}`);
    
    // 解析响应JSON
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`服务器返回的不是有效JSON: ${responseText.substring(0, 100)}...`);
    }
    
    // 只要服务器响应成功处理了数据，不管插入还是更新，都算提交成功
    if (result.success) {
      // 成功后更新统计 - 强制更新统计数据
      scrapeState.submissionStats.success++;
      
      // 强制更新状态并通知UI
      updateState({ 
        submissionStats: scrapeState.submissionStats 
      });
      
      console.log(`[100fun] 成功提交第 ${scrapeState.currentPage} 页数据`);
      console.log(`[100fun] 提交统计更新: 成功=${scrapeState.submissionStats.success}, 失败=${scrapeState.submissionStats.failed}`);
      
      // 记录服务器处理详情
      if (result.details) {
        console.log(`[100fun] 服务器处理结果: 插入=${result.details.inserted}, 更新=${result.details.updated || 0}, 错误=${result.details.errors}`);
      }
      
      return { success: true, message: result.message, details: result.details };
    } else {
      throw new Error(`提交失败: ${result.message}`);
    }
  } catch (err) {
    // 失败后更新统计
    scrapeState.submissionStats.failed++;
    
    // 强制更新状态并通知UI
    updateState({ 
      submissionStats: scrapeState.submissionStats 
    });
    
    console.error(`[100fun] 提交数据出错:`, err);
    console.log(`[100fun] 提交统计更新: 成功=${scrapeState.submissionStats.success}, 失败=${scrapeState.submissionStats.failed}`);
    
    return { success: false, message: `提交数据失败: ${err.message}` };
  }
}

// 抓取当前页数据
async function scrapeCurrentPage() {
  try {
    console.log(`[100fun] 开始抓取第 ${scrapeState.currentPage} 页数据`);
    
    // 更新状态
    await updateState({
      status: 'scraping'
    });
    
    // 执行抓取脚本
    const results = await chrome.scripting.executeScript({
      target: {tabId: scrapeState.targetTabId},
      func: () => {
        try {
          console.log('[100fun] 开始抓取表格数据...');
          
          // 首先尝试获取总条数
          let totalCount = null;
          let perPageSetting = null;
          let totalPages = null;
          let currentPage = 1;
          
          // 获取总记录数
          const totalElement = document.querySelector('.el-pagination__total');
          if (totalElement) {
            const match = totalElement.textContent.match(/共\s*(\d+)\s*条/);
            if (match && match[1]) {
              totalCount = parseInt(match[1], 10);
              console.log(`[100fun] 找到总记录数: ${totalCount} 条`);
            }
          }
          
          // 获取页面上设置的每页条数
          const perPageElement = document.querySelector('.el-pagination__sizes .el-select .el-input__inner');
          if (perPageElement && perPageElement.value) {
            perPageSetting = parseInt(perPageElement.value, 10);
            console.log(`[100fun] 设置的每页条数: ${perPageSetting} 条/页`);
          } else {
            // 尝试从下拉选项中获取
            const selectedItem = document.querySelector('.el-select-dropdown__item.selected');
            if (selectedItem) {
              const match = selectedItem.textContent.match(/(\d+)\s*条\/页/);
              if (match && match[1]) {
                perPageSetting = parseInt(match[1], 10);
                console.log(`[100fun] 从下拉选项获取每页条数: ${perPageSetting} 条/页`);
              }
            }
          }
          
          // 获取当前页码和总页数信息 - 使用更精确的选择器
          console.log('[100fun] 尝试获取页码信息...');
          const pageInput = document.querySelector('.el-pagination__editor.is-in-pagination .el-input__inner') ||
                           document.querySelector('.el-input.el-pagination__editor input.el-input__inner') ||
                           document.querySelector('input.el-input__inner[type="number"]');
          
          if (pageInput) {
            currentPage = parseInt(pageInput.value, 10) || 1;
            if (pageInput.max) {
              totalPages = parseInt(pageInput.max, 10);
            }
            console.log(`[100fun] 找到页码输入框: 当前页=${currentPage}, 总页数=${totalPages}`);
            console.log(`[100fun] 页码输入框详情: min=${pageInput.min}, max=${pageInput.max}`);
          } else {
            // 备用方法：从活动页码获取
            const activePage = document.querySelector('.el-pager .number.active');
            if (activePage) {
              currentPage = parseInt(activePage.textContent, 10);
              console.log(`[100fun] 从活动页码获取: 当前页=${currentPage}`);
            }
          }
          
          // 抓取表格数据
          console.log('[100fun] 开始抓取表格内容...');
          const tables = document.querySelectorAll('.el-table__body');
          if (tables.length === 0) {
            console.log('[100fun] 页面上没有找到表格');
            return {
              success: false, 
              message: '页面上没有找到表格',
              totalCount: totalCount,
              perPageSetting: perPageSetting,
              currentPage: currentPage,
              totalPages: totalPages
            };
          }
          
          console.log(`[100fun] 找到 ${tables.length} 个表格`);
          const extractedTables = [];
          
          tables.forEach((table, tableIndex) => {
            const tableData = {
              id: tableIndex + 1,
              rows: [],
              caption: `表格 ${tableIndex + 1}`
            };
            
            // 获取表头
            let headerRow = [];
            const headerTable = table.closest('.el-table').querySelector('.el-table__header');
            if (headerTable) {
              const headerCells = headerTable.querySelectorAll('th');
              headerCells.forEach(cell => {
                const cellContent = cell.querySelector('.cell') 
                  ? cell.querySelector('.cell').textContent.trim() 
                  : cell.textContent.trim();
                headerRow.push(cellContent);
              });
            }
            
            if (headerRow.length > 0) {
              tableData.rows.push(headerRow);
              console.log(`[100fun] 表格 ${tableIndex + 1} 表头: ${headerRow.length} 列`);
            }
            
            // 获取表格内容
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
              const rowData = [];
              const cells = row.querySelectorAll('td');
              cells.forEach(cell => {
                const cellContent = cell.querySelector('.cell') 
                  ? cell.querySelector('.cell').textContent.trim() 
                  : cell.textContent.trim();
                rowData.push(cellContent);
              });
              
              if (rowData.length > 0) {
                tableData.rows.push(rowData);
              }
            });
            
            console.log(`[100fun] 表格 ${tableIndex + 1} 数据行: ${tableData.rows.length - 1} 行`);
            extractedTables.push(tableData);
          });
          
          // 获取主表格的实际行数（不含表头）
          let actualRows = 0;
          if (extractedTables[0] && extractedTables[0].rows.length > 1) {
            actualRows = extractedTables[0].rows.length - 1;
          }
          
          // 如果没有从页面获取到总页数，则使用实际行数计算
          if (!totalPages && totalCount && actualRows > 0) {
            totalPages = Math.ceil(totalCount / actualRows);
            console.log(`[100fun] 计算总页数: ${totalCount} / ${actualRows} = ${totalPages} 页`);
          }
          
          // 获取分页输入元素，用于自动翻页
          const pageInputInfo = {
            exists: false,
            currentPage: currentPage,
            maxPage: totalPages
          };
          
          if (pageInput) {
            pageInputInfo.exists = true;
            pageInputInfo.selector = getElementSelector(pageInput);
            pageInputInfo.min = pageInput.min;
            pageInputInfo.max = pageInput.max;
            console.log(`[100fun] 获取到页码输入框选择器: ${pageInputInfo.selector}`);
          }
          
          console.log('[100fun] 表格数据抓取完成');
          return {
            success: true,
            message: `成功抓取第 ${currentPage} 页表格数据`,
            data: extractedTables,
            totalCount: totalCount,
            perPageSetting: perPageSetting,
            actualRows: actualRows,
            totalPages: totalPages,
            currentPage: currentPage,
            pageInputInfo: pageInputInfo
          };
        } catch (e) {
          console.error(`[100fun] 抓取表格出错: ${e.message}`);
          return {
            success: false, 
            message: '抓取表格出错: ' + e.message,
            error: e.toString()
          };
        }
        
        // 辅助函数：获取元素的选择器
        function getElementSelector(el) {
          if (el.id) {
            return '#' + CSS.escape(el.id);
          }
          if (el.classList && el.classList.length > 0) {
            return '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
          }
          // 尝试基于属性生成选择器
          if (el.type) {
            return el.tagName.toLowerCase() + '[type="' + el.type + '"].' + el.className.replace(/ /g, '.');
          }
          return el.tagName.toLowerCase() + '.' + el.className.replace(/ /g, '.');
        }
      }
    });
    
    // 处理结果
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      if (result.success) {
        console.log(`[100fun] 抓取第 ${scrapeState.currentPage} 页成功`);
        
        // 保存数据到集合
        const pageData = {
          pageNumber: scrapeState.currentPage,
          data: result.data[0], // 假设我们只关注第一个表格
          timestamp: new Date().toISOString()
        };
        
        // 提交数据到服务器
        const submitResult = await submitPageDataToServer(result.data[0]);
        
        // 记录提交结果
        if (submitResult.success) {
          console.log(`[100fun] 提交第 ${scrapeState.currentPage} 页数据成功: ${submitResult.message}`);
        } else {
          console.error(`[100fun] 提交第 ${scrapeState.currentPage} 页数据失败: ${submitResult.message}`);
        }
        
        // 更新状态
        const newState = {
          totalRecords: result.totalCount || scrapeState.totalRecords,
          totalPages: result.totalPages || scrapeState.totalPages,
          collectedPages: scrapeState.collectedPages + 1,
          allPagesData: [...scrapeState.allPagesData, pageData]
        };
        
        await updateState(newState);
        
        // 检查是否需要继续翻页
        if (!result.totalPages || scrapeState.currentPage < result.totalPages) {
          // 还有下一页，准备翻页
          const nextPage = scrapeState.currentPage + 1;
          
          // 生成0.5-1秒的随机延迟
          const pageLoadDelay = Math.floor(1000 + Math.random() * 500);
          console.log(`[100fun] 准备在 ${pageLoadDelay}ms 后翻到第 ${nextPage} 页`);
          
          // 更新状态显示翻页延迟
          await updateState({
            status: 'page_loading',
            nextPageDelay: pageLoadDelay
          });
          
          // 延迟执行翻页
          setTimeout(() => goToNextPage(nextPage, result.pageInputInfo), pageLoadDelay);
        } else {
          // 已到最后一页，抓取完成
          console.log(`[100fun] 全部 ${result.totalPages} 页抓取完成`);
          finishScrapeRound();
        }
      } else {
        // 抓取失败
        handleError(`抓取失败: ${result.message}`);
      }
    } else {
      handleError('执行抓取脚本失败');
    }
  } catch (err) {
    handleError(`抓取第 ${scrapeState.currentPage} 页出错: ${err.message}`);
  }
}

// 翻到下一页
async function goToNextPage(pageNumber, pageInputInfo) {
  try {
    console.log(`[100fun] 尝试翻到第 ${pageNumber} 页`);
    
    // 更新当前页码
    await updateState({
      currentPage: pageNumber,
      status: 'navigating'
    });
    
    // 执行翻页脚本
    const results = await chrome.scripting.executeScript({
      target: {tabId: scrapeState.targetTabId},
      func: (pageNumber, inputSelector) => {
        try {
          console.log("[100fun] 尝试查找页码输入框...");
          
          // 优先使用更精确的选择器定位页码输入框
          const pageInput = document.querySelector('.el-pagination__editor.is-in-pagination .el-input__inner') || 
                            document.querySelector('.el-input.el-pagination__editor input.el-input__inner') ||
                            document.querySelector('input.el-input__inner[type="number"]') ||
                            (inputSelector ? document.querySelector(inputSelector) : null);
          
          if (!pageInput) {
            console.error("[100fun] 找不到页码输入框");
            return {success: false, message: '找不到页码输入框'};
          }
          
          console.log(`[100fun] 找到页码输入框：${pageInput.tagName}.${pageInput.className}`);
          
          // 简化的输入行为
          pageInput.value = pageNumber;
          console.log(`[100fun] 设置页码为: ${pageNumber}`);
          
          // 创建并分发输入事件
          const inputEvent = new Event('input', {bubbles: true});
          pageInput.dispatchEvent(inputEvent);
          
          // 创建并分发变更事件
          const changeEvent = new Event('change', {bubbles: true});
          pageInput.dispatchEvent(changeEvent);
          
          // 创建并分发回车键事件
          const keyEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13
          });
          pageInput.dispatchEvent(keyEvent);
          console.log('[100fun] 触发页面跳转');
          
          return {
            success: true, 
            message: `已设置页码并提交: ${pageNumber}`,
            pageNumber: pageNumber
          };
        } catch (e) {
          console.error(`[100fun] 翻页出错: ${e.message}`);
          return {
            success: false, 
            message: '翻页出错: ' + e.message,
            error: e.toString()
          };
        }
      },
      args: [pageNumber, pageInputInfo.selector]
    });
    
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      if (result.success) {
        console.log(`[100fun] 成功翻到第 ${pageNumber} 页`);
        
        // 页面加载延迟1-3秒
        const pageLoadDelay = Math.floor(1000 + Math.random() * 2000);
        console.log(`[100fun] 等待 ${pageLoadDelay}ms 页面加载...`);
        
        // 更新状态
        await updateState({
          status: 'page_loading'
        });
        
        // 延迟后抓取新页面
        setTimeout(() => scrapeCurrentPage(), pageLoadDelay);
      } else {
        handleError(`翻页失败: ${result.message}`);
      }
    } else {
      handleError('执行翻页脚本失败');
    }
  } catch (err) {
    handleError(`翻到第 ${pageNumber} 页出错: ${err.message}`);
  }
}

// 完成一轮抓取
async function finishScrapeRound() {
  try {
    console.log(`[100fun] 完成第 ${scrapeState.currentRound} 轮抓取`);
    
    // 更新状态
    const updateData = {
      isRunning: false,
      status: 'completed',
      currentRound: scrapeState.currentRound + 1
    };
    
    // 如果启用了周期性抓取，设置下次抓取时间
    if (scrapeState.isPeriodic) {
      const nextTime = new Date();
      nextTime.setMinutes(nextTime.getMinutes() + scrapeState.periodicInterval);
      
      updateData.status = 'waiting';
      updateData.nextScrapeTime = nextTime.toISOString();
      
      console.log(`[100fun] 设置下次抓取时间: ${nextTime.toLocaleString()}`);
      
      // 设置报警器
      setupPeriodicAlarm(scrapeState.periodicInterval);
    }
    
    await updateState(updateData);
    
  } catch (err) {
    console.error('[100fun] 完成抓取轮次出错:', err);
  }
}

// 处理错误
async function handleError(errorMsg) {
  console.error(`[100fun] 错误: ${errorMsg}`);
  
  // 更新状态
  await updateState({
    isRunning: false,
    status: 'error',
    error: errorMsg
  });
}

// 合并所有页面数据
function mergeAllPagesData() {
  if (!scrapeState.allPagesData || scrapeState.allPagesData.length === 0) {
    return null;
  }
  
  // 获取第一页的数据结构（包含表头）
  const firstPage = scrapeState.allPagesData[0].data;
  const headerRow = firstPage.rows[0];
  
  // 创建合并后的表格对象
  const mergedTable = {
    id: 1,
    caption: '合并数据',
    rows: [headerRow] // 添加表头
  };
  
  // 按页码排序
  const sortedPages = [...scrapeState.allPagesData].sort((a, b) => a.pageNumber - b.pageNumber);
  
  // 合并所有页的数据（跳过表头）
  let totalRows = 0;
  sortedPages.forEach(page => {
    if (page.data && page.data.rows && page.data.rows.length > 1) {
      const dataRows = page.data.rows.slice(1); // 跳过表头
      mergedTable.rows.push(...dataRows);
      totalRows += dataRows.length;
    }
  });
  
  console.log(`[100fun] 已合并 ${sortedPages.length} 页数据，共 ${totalRows} 行记录`);
  return mergedTable;
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('[100fun] 收到消息:', request.action || request.type);
  
  // 确保先标记我们要异步响应
  let asyncResponseExpected = false;
  
  try {
    // 处理新旧消息格式兼容性
    const action = request.action || request.type;
    
    switch(action) {
      case 'getState':
      case 'STATE_REQUEST':
        // 立即发送当前状态
        sendResponse({
          success: true, 
          state: scrapeState,
          payload: scrapeState  // 兼容新旧格式
        });
        break;
        
      case 'startScrape':
      case 'START_SCRAPING':
        // 开始抓取
        asyncResponseExpected = true;
        startNewScrapeRound()
          .then(() => sendResponse({success: true, message: '已开始抓取任务'}))
          .catch(err => sendResponse({success: false, message: err.message}));
        break;
        
      case 'stopScrape':
      case 'STOP_SCRAPING':
        // 停止抓取
        try {
          updateState({isRunning: false, status: 'stopped'});
          sendResponse({success: true, message: '已停止抓取任务'});
        } catch (err) {
          sendResponse({success: false, message: err.message});
        }
        break;
        
      case 'togglePeriodic':
        // 切换周期性抓取状态
        try {
          const newStatus = request.enabled !== undefined ? 
            Boolean(request.enabled) : !scrapeState.isPeriodic;
          
          console.log(`[100fun] 周期性抓取状态变更: ${scrapeState.isPeriodic} -> ${newStatus}`);
          
          // 更新状态
          updateState({
            isPeriodic: newStatus,
            nextScrapeTime: newStatus ? new Date(Date.now() + scrapeState.periodicInterval * 60000).toISOString() : null
          });
          
          // 如果禁用，清除报警
          if (!newStatus) {
            chrome.alarms.clear("periodicScrape");
            console.log('[100fun] 已禁用周期性抓取，清除报警');
          } 
          // 如果启用，设置报警
          else {
            const interval = scrapeState.periodicInterval || 5;
            setupPeriodicAlarm(interval);
            console.log(`[100fun] 已启用周期性抓取，间隔：${interval}分钟`);
          }
          
          // 立即发送响应
          sendResponse({
            success: true, 
            message: newStatus ? '已启用周期性抓取' : '已禁用周期性抓取'
          });
        } catch (err) {
          console.error('[100fun] 切换周期性抓取出错:', err);
          sendResponse({success: false, message: '操作失败: ' + err.message});
        }
        break;
        
      case 'updateInterval':
        // 更新抓取间隔
        try {
          // 获取新间隔
          let newInterval = parseInt(request.interval);
          if (isNaN(newInterval) || newInterval < 1) {
            newInterval = 5; // 默认5分钟
          }
          
          console.log(`[100fun] 更新周期间隔: ${scrapeState.periodicInterval} -> ${newInterval}分钟`);
          
          // 更新状态
          updateState({
            periodicInterval: newInterval,
            nextScrapeTime: scrapeState.isPeriodic ? new Date(Date.now() + newInterval * 60000).toISOString() : null
          });
          
          // 如果周期性抓取已启用，重新设置报警
          if (scrapeState.isPeriodic) {
            setupPeriodicAlarm(newInterval);
            console.log(`[100fun] 已重设报警，间隔：${newInterval}分钟`);
          }
          
          // 立即发送响应
          sendResponse({
            success: true,
            message: `已更新周期间隔为 ${newInterval} 分钟`
          });
        } catch (err) {
          console.error('[100fun] 更新周期间隔出错:', err);
          sendResponse({success: false, message: '更新间隔失败: ' + err.message});
        }
        break;
        
      case 'clearData':
      case 'CLEAR_DATA':
        // 清除数据
        try {
          updateState({
            allPagesData: [],
            collectedPages: 0,
            currentRound: 1,
            status: 'idle',
            error: null,
            submissionStats: {
              success: 0,
              failed: 0
            }
          });
          sendResponse({success: true, message: '数据已清除'});
        } catch (err) {
          sendResponse({success: false, message: '清除数据失败: ' + err.message});
        }
        break;
        
      case 'resetStats':
      case 'STATS_RESET':
        // 重置统计
        try {
          updateState({
            submissionStats: {
              success: 0,
              failed: 0
            }
          });
          sendResponse({success: true, message: '统计数据已重置'});
        } catch (err) {
          sendResponse({success: false, message: '重置统计失败: ' + err.message});
        }
        break;
        
      case 'fullResetApplication':
        try {
          console.log('[100fun] 执行完整重置操作');
          
          // 停止所有抓取任务
          scrapeState.isRunning = false;
          
          // 禁用周期性抓取
          scrapeState.isPeriodic = false;
          
          // 清除所有报警
          chrome.alarms.clearAll(() => {
            console.log('[100fun] 已清除所有报警');
          });
          
          // 重置状态为完全初始状态
          scrapeState = {
            isRunning: false,          // 是否正在运行抓取任务
            isPeriodic: false,         // 是否启用周期性抓取
            targetTabId: null,         // 目标标签页ID
            currentPage: 1,            // 当前页码
            totalPages: 0,             // 总页数
            totalRecords: 0,           // 总记录数
            collectedPages: 0,         // 已收集的页数
            periodicInterval: 5,       // 周期间隔(分钟)
            lastScrapeTime: null,      // 上次抓取时间
            nextScrapeTime: null,      // 下次抓取时间
            allPagesData: [],          // 所有页面数据
            currentRound: 1,           // 当前抓取轮次
            status: 'idle',            // 当前状态: idle, scraping, waiting, error
            error: null,               // 错误信息
            submissionStats: {         // 提交数据统计
              success: 0,
              failed: 0
            }
          };
          
          // 保存重置后的状态
          updateState(scrapeState);
          
          // 发送响应
          sendResponse({
            success: true,
            message: '插件已完全重置，将在几秒钟后重新加载'
          });
        } catch (err) {
          console.error('[100fun] 重置插件出错:', err);
          sendResponse({success: false, message: '重置插件失败: ' + err.message});
        }
        break;

      case 'testServerConnection':
      case 'TEST_CONNECTION':
        // 测试服务器连接
        asyncResponseExpected = true;
        (async () => {
          try {
            console.log('[100fun] 正在测试服务器连接...');
            
            const response = await fetch('https://hskg.vivemall.com/scraper_vip.php', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                test: true,
                timestamp: new Date().toISOString()
              })
            });
            
            console.log(`[100fun] 服务器响应状态: ${response.status} ${response.statusText}`);
            
            // 读取响应文本
            const text = await response.text();
            console.log(`[100fun] 服务器响应内容: ${text.substring(0, 200)}...`);
            
            // 尝试解析JSON
            try {
              const result = JSON.parse(text);
              sendResponse({
                success: true,
                message: result.message || '服务器连接测试成功',
                timestamp: result.timestamp || new Date().toISOString()
              });
            } catch (e) {
              // 非JSON响应但服务器有回应
              sendResponse({
                success: true, 
                message: `收到非JSON响应，但服务器连接正常: ${text.substring(0, 100)}...`
              });
            }
          } catch (err) {
            // 连接失败
            console.error('[100fun] 测试连接失败:', err);
            sendResponse({
              success: false,
              message: `连接服务器失败: ${err.message}`
            });
          }
        })();
        break;
        
      default:
        console.log('[100fun] 收到未知操作:', action);
        sendResponse({success: false, message: '未知操作: ' + action});
    }
  } catch (err) {
    console.error('[100fun] 处理消息时出错:', err);
    sendResponse({success: false, message: '处理消息出错: ' + err.message});
  }
  
  // 返回true表示将异步发送响应
  return asyncResponseExpected || true;
});

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener((tabId) => {
  // 如果关闭的是目标标签页，停止抓取
  if (tabId === scrapeState.targetTabId && scrapeState.isRunning) {
    console.log('[100fun] 目标标签页已关闭，停止抓取');
    updateState({
      isRunning: false,
      status: 'tab_closed',
      error: '目标标签页已关闭'
    });
  }
});

console.log('[100fun] 后台服务脚本已加载');