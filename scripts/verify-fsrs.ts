import { fsrs, createEmptyCard, Rating, State } from 'ts-fsrs';

console.log('--- FSRS 演算法整合驗證開始 ---\\n');

// 1. 初始化 FSRS 實例
const f = fsrs();

// 2. 建立一張全新的卡片
const card = createEmptyCard();
const now = new Date();

console.log('【初始化卡片】');
console.log(`- 狀態: ${State[card.state]} (New)`);
console.log(`- 目前時間: ${now.toISOString()}\\n`);

// 3. 計算這張新卡片給予四種評分 (Again, Hard, Good, Easy) 的未來狀態
const schedulingCards = f.repeat(card, now);

// 4. 印出每種評分的結果
const ratings = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

ratings.forEach((rating) => {
    const recordLog = (schedulingCards as any)[rating];
    if (!recordLog) return;
    const newCardState = recordLog.card;
    const interval = newCardState.scheduled_days;
    
    // 計算差異時間的簡單呈現
    const dueTime = newCardState.due;
    const diffMs = dueTime.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / 1000 / 60);
    const diffHours = (diffMinutes / 60).toFixed(1);
    
    let intervalStr = '';
    if (diffMinutes < 60) {
        intervalStr = `${diffMinutes}m`;
    } else if (diffMinutes < 24 * 60) {
        intervalStr = `${diffHours}h`;
    } else {
        intervalStr = `${interval}d`;
    }

    console.log(`如果選擇評分 [${Rating[rating]}] :`);
    console.log(`  - 顯示間隔: ${intervalStr}`);
    console.log(`  - 下次到期: ${dueTime.toISOString()}`);
    console.log(`  - 新狀態: ${State[newCardState.state]}`);
    console.log('---------------------------');
});

console.log('\\n--- 驗證成功 ---');
