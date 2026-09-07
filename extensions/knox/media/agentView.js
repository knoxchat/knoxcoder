// Agent View WebView Script
(function() {
    // Get vscode API
    const vscode = acquireVsCodeApi();
    
    // Cache DOM elements
    const operationsContainer = document.getElementById('operationsContainer');
    const noOperationsMsg = document.getElementById('noOperations');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const toggleAutoScrollBtn = document.getElementById('toggleAutoScrollBtn');
    const clearBtn = document.getElementById('clearBtn');
    const multiOperationIndicator = document.getElementById('multiOperationIndicator');
    
    // Add CSS styles for the scroll indicator
    function addScrollIndicatorStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .scroll-indicator {
                position: fixed;
                bottom: -60px;
                right: 20px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                cursor: pointer;
                transition: bottom 0.3s ease;
                z-index: 1000;
                user-select: none;
            }
            
            .scroll-indicator.active {
                bottom: 20px;
            }
            
            .scroll-indicator:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        `;
        document.head.appendChild(style);
    }
    
    // State
    let operations = [];
    let scrollSyncEnabled = true;
    let activeOperationId = null;
    let highlightedOperationId = null;
    let expandedCodeBlocks = new Set(); // Track which code blocks are expanded
    let isGenerating = false; // Track if we're currently generating text
    let scrollObserver = null; // Intersection observer for scroll tracking
    let lastScrollPosition = 0; // Track last scroll position
    let autoScrollTimer = null; // Timer for debounced auto-scrolling
    let userHasScrolled = false; // Track if user has manually scrolled
    let scrollIndicatorTimer = null; // Timer for hiding scroll indicator
    
    // Initialize
    window.addEventListener('message', handleMessage);
    initScrollObserver();
    createScrollIndicator();
    
    // Notify the extension that the webview is ready
    vscode.postMessage({
        command: 'webviewReady'
    });
    
    // Set up button listeners
    toggleAutoScrollBtn.addEventListener('click', () => {
        vscode.postMessage({
            command: 'toggleScrollSync'
        });
    });
    
    clearBtn.addEventListener('click', () => {
        operations = [];
        expandedCodeBlocks.clear(); // Clear expanded state when clearing operations
        renderOperations();
        updateStatus('idle');
        vscode.postMessage({
            command: 'clearOperations'
        });
    });
    
    /**
     * Create the floating scroll indicator
     */
    function createScrollIndicator() {
        const scrollIndicator = document.createElement('div');
        scrollIndicator.className = 'scroll-indicator';
        scrollIndicator.id = 'scroll-indicator';
        scrollIndicator.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                <path d="M8 13.5l-4-4h8l-4 4z"/>
            </svg>
            <span>生成新内容</span>
        `;
        scrollIndicator.addEventListener('click', scrollToBottom);
        document.body.appendChild(scrollIndicator);
        return scrollIndicator;
    }
    
    /**
     * Show the scroll indicator
     */
    function showScrollIndicator() {
        const indicator = document.getElementById('scroll-indicator');
        if (!indicator) return;
        
        indicator.classList.add('active');
        
        // Set a timer to hide the indicator after 3 seconds
        if (scrollIndicatorTimer) {
            clearTimeout(scrollIndicatorTimer);
        }
        
        scrollIndicatorTimer = setTimeout(() => {
            hideScrollIndicator();
        }, 3000);
    }
    
    /**
     * Hide the scroll indicator
     */
    function hideScrollIndicator() {
        const indicator = document.getElementById('scroll-indicator');
        if (!indicator) return;
        
        indicator.classList.remove('active');
        
        if (scrollIndicatorTimer) {
            clearTimeout(scrollIndicatorTimer);
            scrollIndicatorTimer = null;
        }
    }
    
    /**
     * Initialize scroll observer to detect when user scrolls away from bottom
     */
    function initScrollObserver() {
        // Create a sentinel element to observe
        const scrollSentinel = document.createElement('div');
        scrollSentinel.id = 'scroll-sentinel';
        scrollSentinel.style.height = '1px';
        scrollSentinel.style.width = '100%';
        operationsContainer.appendChild(scrollSentinel);
        
        // Set up intersection observer
        scrollObserver = new IntersectionObserver((entries) => {
            // If sentinel is visible, we're at the bottom
            const isAtBottom = entries[0].isIntersecting;
            
            // Only auto-scroll if we're at the bottom or if user hasn't manually scrolled
            if (isAtBottom) {
                userHasScrolled = false;
                
                // If we're generating content, we should hide the indicator
                if (isGenerating) {
                    hideScrollIndicator();
                }
            } else if (isGenerating && scrollSyncEnabled && !userHasScrolled) {
                // We're generating content but not at the bottom, show the indicator
                showScrollIndicator();
            }
        }, {
            root: operationsContainer, 
            threshold: 0.1
        });
        
        // Start observing
        scrollObserver.observe(scrollSentinel);
        
        // Add scroll event listener
        operationsContainer.addEventListener('scroll', onContainerScroll);
    }
    
    /**
     * Handle container scroll events
     */
    function onContainerScroll() {
        // Detect if this is a user-initiated scroll
        const isUserScroll = !autoScrollTimer;
        
        // If user is scrolling manually and we're generating content
        if (isUserScroll && isGenerating) {
            // Get sentinel element and check if we're not at the bottom
            const isAtBottom = isScrolledToBottom();
            
            if (!isAtBottom) {
                userHasScrolled = true;
                showScrollIndicator();
            } else {
                userHasScrolled = false;
                hideScrollIndicator();
            }
        }
        
        // Update last scroll position
        lastScrollPosition = operationsContainer.scrollTop;
    }
    
    /**
     * Check if the container is scrolled to the bottom
     */
    function isScrolledToBottom() {
        const threshold = 50; // pixels from bottom to consider "at bottom"
        const scrollPosition = operationsContainer.scrollTop;
        const containerHeight = operationsContainer.clientHeight;
        const scrollHeight = operationsContainer.scrollHeight;
        
        return scrollPosition + containerHeight >= scrollHeight - threshold;
    }
    
    /**
     * Scroll to the bottom of the operations container
     */
    function scrollToBottom(force = false) {
        if (!force && !scrollSyncEnabled) return;
        
        const scrollSentinel = document.getElementById('scroll-sentinel');
        if (scrollSentinel) {
            scrollSentinel.scrollIntoView({ behavior: 'smooth' });
        } else {
            operationsContainer.scrollTop = operationsContainer.scrollHeight;
        }
        
        // Reset user scroll state since we're now at the bottom
        userHasScrolled = false;
    }
    
    /**
     * Auto-scroll to the bottom if needed
     */
    function autoScrollToBottom() {
        // Only auto-scroll if enabled and generating and user hasn't manually scrolled away
        if (!scrollSyncEnabled || !isGenerating || userHasScrolled) {
            if (isGenerating && !isScrolledToBottom()) {
                showScrollIndicator();
            }
            return;
        }
        
        // Clear any pending scroll timer
        if (autoScrollTimer) {
            clearTimeout(autoScrollTimer);
        }
        
        // Debounce scroll to reduce performance impact
        autoScrollTimer = setTimeout(() => {
            scrollToBottom();
            autoScrollTimer = null;
        }, 100);
    }
    
    /**
     * Update scroll sentinel position
     */
    function updateScrollSentinel() {
        const scrollSentinel = document.getElementById('scroll-sentinel');
        if (!scrollSentinel) return;
        
        // Remove the sentinel first
        if (scrollSentinel.parentNode) {
            scrollSentinel.parentNode.removeChild(scrollSentinel);
        }
        
        // Add it back to the end of the container
        operationsContainer.appendChild(scrollSentinel);
        
        // Update observation
        scrollObserver.observe(scrollSentinel);
        
        // Auto-scroll if needed
        autoScrollToBottom();
    }
    
    /**
     * Handle messages from the extension
     */
    function handleMessage(event) {
        const message = event.data;
        
        switch (message.type) {
            case 'initState':
                // Initialize state from extension
                operations = message.data.operations || [];
                scrollSyncEnabled = message.data.scrollSyncEnabled;
                updateScrollSyncButton(scrollSyncEnabled);
                
                if (message.data.activeOperation) {
                    activeOperationId = message.data.activeOperation.id;
                    isGenerating = message.data.activeOperation.status === 'in_progress';
                }
                
                if (message.data.isProcessingMultiOperation) {
                    showMultiOperationIndicator();
                    isGenerating = true;
                } else {
                    hideMultiOperationIndicator();
                    isGenerating = false;
                }
                
                renderOperations();
                updateScrollSentinel();
                
                // Update status
                if (message.data.activeOperation) {
                    updateStatus('processing');
                } else if (operations.some(op => op.status === 'failed')) {
                    updateStatus('error');
                } else if (operations.length > 0) {
                    updateStatus('completed');
                } else {
                    updateStatus('idle');
                }
                break;
                
            case 'operationQueued':
                // Add a new operation to the list
                operations.push(message.data.operation);
                isGenerating = true;
                renderOperations();
                updateScrollSentinel();
                break;
                
            case 'operationStarted':
                // Update operation status
                updateOperation(message.data.operation);
                activeOperationId = message.data.operation.id;
                isGenerating = true;
                
                // Update status
                updateStatus('processing');
                updateScrollSentinel();
                break;
                
            case 'operationCompleted':
                // Update operation status
                updateOperation(message.data.operation);
                
                // Check if there are still active operations
                if (!operations.some(op => op.status === 'in_progress')) {
                    updateStatus('completed');
                    isGenerating = false;
                    hideScrollIndicator(); // Hide indicator when all operations complete
                }
                
                updateScrollSentinel();
                break;
                
            case 'operationFailed':
                // Update operation status
                updateOperation(message.data.operation);
                
                // Update status
                updateStatus('error');
                isGenerating = false;
                hideScrollIndicator(); // Hide indicator when operation fails
                updateScrollSentinel();
                break;
                
            case 'operationQueueEmpty':
                hideMultiOperationIndicator();
                isGenerating = false;
                hideScrollIndicator(); // Hide indicator when queue is empty
                
                // Update status
                if (operations.some(op => op.status === 'failed')) {
                    updateStatus('error');
                } else {
                    updateStatus('completed');
                }
                
                updateScrollSentinel();
                break;
                
            case 'multiOperationStarted':
                showMultiOperationIndicator(message.data.count);
                isGenerating = true;
                updateScrollSentinel();
                break;
                
            case 'scrollToOperation':
                scrollToOperation(message.data.operationId);
                break;
                
            case 'highlightOperation':
                highlightOperation(message.data.operationId);
                break;
                
            case 'scrollSyncChanged':
                updateScrollSyncButton(message.data.enabled);
                // If enabling auto-scroll and we're generating, scroll to bottom
                if (message.data.enabled && isGenerating) {
                    autoScrollToBottom();
                }
                break;
                
            case 'operationHistoryCleared':
                operations = [];
                expandedCodeBlocks.clear(); // Clear expanded state when clearing operations
                isGenerating = false;
                renderOperations();
                updateStatus('idle');
                updateScrollSentinel();
                break;
                
            case 'viewNextOperation':
                navigateToNextOperation();
                break;
                
            case 'viewPreviousOperation':
                navigateToPreviousOperation();
                break;
        }
    }
    
    /**
     * Update operation in the list
     */
    function updateOperation(updatedOperation) {
        const index = operations.findIndex(op => op.id === updatedOperation.id);
        if (index !== -1) {
            operations[index] = updatedOperation;
        } else {
            operations.push(updatedOperation);
        }
        
        renderOperations();
        
        if (scrollSyncEnabled && activeOperationId === updatedOperation.id) {
            if (updatedOperation.status === 'in_progress') {
                // If operation is in progress, scroll to its latest content
                autoScrollToBottom();
            } else {
                // Otherwise just scroll the operation into view
                scrollToOperation(updatedOperation.id);
            }
        }
    }
    
    /**
     * Render all operations
     */
    function renderOperations() {
        // Clear container except for the sentinel
        const scrollSentinel = document.getElementById('scroll-sentinel');
        while (operationsContainer.firstChild !== noOperationsMsg && operationsContainer.firstChild !== scrollSentinel) {
            operationsContainer.removeChild(operationsContainer.firstChild);
        }
        
        // Show/hide no operations message
        if (operations.length === 0) {
            noOperationsMsg.style.display = 'block';
            return;
        } else {
            noOperationsMsg.style.display = 'none';
        }
        
        // Render each operation
        operations.forEach(operation => {
            const operationElement = createOperationElement(operation);
            // Insert before sentinel
            if (scrollSentinel && scrollSentinel.parentNode === operationsContainer) {
                operationsContainer.insertBefore(operationElement, scrollSentinel);
            } else {
                operationsContainer.appendChild(operationElement);
            }
        });
        
        // If generating and auto-scroll enabled, scroll to bottom
        if (isGenerating && scrollSyncEnabled) {
            autoScrollToBottom();
        }
    }
    
    /**
     * Create an element for an operation
     */
    function createOperationElement(operation) {
        const element = document.createElement('div');
        element.id = `operation-${operation.id}`;
        element.className = `operation operation-${operation.type} operation-status-${operation.status}`;
        
        if (operation.id === activeOperationId) {
            element.classList.add('operation-active');
        }
        
        if (operation.id === highlightedOperationId) {
            element.classList.add('operation-highlighted');
        }
        
        // Operation header
        const header = document.createElement('div');
        header.className = 'operation-header';
        
        // Type icon
        const typeIcon = document.createElement('span');
        typeIcon.className = 'operation-type-icon';
        switch (operation.type) {
            case 'code_generation':
                typeIcon.innerHTML = '📝';
                break;
            case 'file_reading':
                typeIcon.innerHTML = '📂';
                break;
            case 'command_execution':
                typeIcon.innerHTML = '🖥️';
                break;
            case 'tool_call':
                typeIcon.innerHTML = '🔧';
                break;
            case 'context_gathering':
                typeIcon.innerHTML = '🔍';
                break;
        }
        header.appendChild(typeIcon);
        
        // Operation title
        const title = document.createElement('span');
        title.className = 'operation-title';
        title.textContent = getOperationTitle(operation);
        header.appendChild(title);
        
        // Status indicator
        const statusDot = document.createElement('span');
        statusDot.className = 'operation-status-dot';
        
        switch (operation.status) {
            case 'queued':
                statusDot.title = 'Queued';
                break;
            case 'in_progress':
                statusDot.title = 'In Progress';
                break;
            case 'completed':
                statusDot.title = 'Completed';
                break;
            case 'failed':
                statusDot.title = 'Failed';
                break;
            case 'canceled':
                statusDot.title = 'Canceled';
                break;
        }
        
        header.appendChild(statusDot);
        element.appendChild(header);
        
        // Operation content
        const content = document.createElement('div');
        content.className = 'operation-content';
        
        // Operation description
        const description = document.createElement('div');
        description.className = 'operation-description';
        description.textContent = operation.description;
        content.appendChild(description);
        
        // Operation result/error
        if (operation.status === 'completed' && operation.result) {
            const result = document.createElement('div');
            result.className = 'operation-result';
            
            // Format result based on operation type
            let resultText = '';
            let hasCodeContent = false;
            
            switch (operation.type) {
                case 'code_generation':
                    resultText = `Generated code in ${operation.result.filePath}`;
                    hasCodeContent = !!operation.result.content || !!operation.result.code;
                    break;
                case 'file_reading':
                    resultText = `Read ${operation.result.filePath}`;
                    hasCodeContent = !!operation.result.content;
                    break;
                case 'command_execution':
                    resultText = `Executed command in ${operation.result.cwd}`;
                    hasCodeContent = !!operation.result.output;
                    if (hasCodeContent) {
                        operation.result.content = operation.result.output; // Normalize for code display
                    }
                    break;
                case 'tool_call':
                    resultText = `Executed tool: ${operation.result?.toolName || 'Tool'}`;
                    hasCodeContent = !!(operation.result?.content || operation.result?.code || 
                                     (operation.result?.filePath && (operation.payload?.toolCall?.function?.name || '').includes('file')));
                    break;
                case 'context_gathering':
                    resultText = `Gathered ${operation.result?.contextSize || 0} bytes of context`;
                    break;
            }
            
            const resultTextElement = document.createElement('span');
            resultTextElement.textContent = resultText;
            result.appendChild(resultTextElement);
            
            // Add chevron and detailed result if needed
            if (hasCodeContent) {
                const isExpanded = expandedCodeBlocks.has(operation.id);
                
                // Add chevron indicator
                const chevronContainer = document.createElement('div');
                chevronContainer.className = 'chevron-container';
                chevronContainer.title = isExpanded ? 'Collapse' : 'Expand';
                
                const chevron = document.createElement('span');
                chevron.className = `chevron ${isExpanded ? 'chevron-down' : 'chevron-right'}`;
                chevron.innerHTML = isExpanded ? '▼' : '▶';
                
                chevronContainer.appendChild(chevron);
                chevronContainer.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent operation from being highlighted
                    toggleCodeContent(operation.id);
                });
                
                result.appendChild(chevronContainer);
                content.appendChild(result);
                
                // Create code content container
                const codeContainer = document.createElement('div');
                codeContainer.className = 'code-container';
                codeContainer.id = `code-container-${operation.id}`;
                if (!isExpanded) {
                    codeContainer.style.display = 'none';
                }
                
                const codeBlock = document.createElement('pre');
                codeBlock.className = 'code-block';
                codeBlock.textContent = operation.result.content || operation.result.code || '';
                
                codeContainer.appendChild(codeBlock);
                content.appendChild(codeContainer);
            } else {
                content.appendChild(result);
            }
        } else if (operation.status === 'failed' && operation.error) {
            const error = document.createElement('div');
            error.className = 'operation-error';
            error.textContent = `Error: ${operation.error.message || 'Unknown error'}`;
            
            // Add retry button
            const retryBtn = document.createElement('button');
            retryBtn.className = 'operation-action-button retry-button';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent operation from being highlighted
                vscode.postMessage({
                    command: 'retryOperation',
                    operationId: operation.id
                });
            });
            
            error.appendChild(retryBtn);
            content.appendChild(error);
        }
        
        element.appendChild(content);
        
        // Add click handler for selection
        element.addEventListener('click', () => {
            highlightOperation(operation.id);
            vscode.postMessage({
                command: 'viewOperation',
                operationId: operation.id
            });
        });
        
        return element;
    }
    
    /**
     * Get title for an operation
     */
    function getOperationTitle(operation) {
        switch (operation.type) {
            case 'code_generation':
                return 'Generate Code';
            case 'file_reading':
                return 'Read File';
            case 'command_execution':
                return 'Execute Command';
            case 'tool_call':
                const toolName = operation.payload?.toolCall?.function?.name || 'Tool Call';
                return `Tool: ${toolName}`;
            case 'context_gathering':
                return 'Gather Context';
            default:
                return 'Operation';
        }
    }
    
    /**
     * Toggle code content visibility with chevron
     */
    function toggleCodeContent(operationId) {
        const codeContainer = document.getElementById(`code-container-${operationId}`);
        const operationElement = document.getElementById(`operation-${operationId}`);
        
        if (!codeContainer || !operationElement) return;
        
        const chevron = operationElement.querySelector('.chevron');
        
        if (codeContainer.style.display === 'none') {
            // Expand
            codeContainer.style.display = 'block';
            expandedCodeBlocks.add(operationId); // Track expanded state
            
            if (chevron) {
                chevron.innerHTML = '▼';
                chevron.className = 'chevron chevron-down';
                chevron.parentElement.title = 'Collapse';
            }
            
            // Scroll to make the code visible
            setTimeout(() => {
                codeContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        } else {
            // Collapse
            codeContainer.style.display = 'none';
            expandedCodeBlocks.delete(operationId); // Track collapsed state
            
            if (chevron) {
                chevron.innerHTML = '▶';
                chevron.className = 'chevron chevron-right';
                chevron.parentElement.title = 'Expand';
            }
        }
    }
    
    /**
     * Update the status indicator
     */
    function updateStatus(status) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add(`status-${status}`);
        
        switch (status) {
            case 'idle':
                statusText.textContent = 'Idle';
                break;
            case 'processing':
                statusText.textContent = 'Processing';
                break;
            case 'completed':
                statusText.textContent = 'Completed';
                break;
            case 'error':
                statusText.textContent = 'Error';
                break;
        }
    }
    
    /**
     * Scroll to a specific operation
     */
    function scrollToOperation(operationId) {
        const element = document.getElementById(`operation-${operationId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    
    /**
     * Highlight a specific operation
     */
    function highlightOperation(operationId) {
        // Remove highlight from previously highlighted operation
        if (highlightedOperationId) {
            const prevElement = document.getElementById(`operation-${highlightedOperationId}`);
            if (prevElement) {
                prevElement.classList.remove('operation-highlighted');
            }
        }
        
        // Highlight new operation
        highlightedOperationId = operationId;
        const element = document.getElementById(`operation-${operationId}`);
        if (element) {
            element.classList.add('operation-highlighted');
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    
    /**
     * Show multi-operation indicator
     */
    function showMultiOperationIndicator(count) {
        multiOperationIndicator.classList.remove('hidden');
        
        if (count) {
            multiOperationIndicator.querySelector('.indicator-text').textContent = 
                `Processing ${count} operations...`;
        }
    }
    
    /**
     * Hide multi-operation indicator
     */
    function hideMultiOperationIndicator() {
        multiOperationIndicator.classList.add('hidden');
    }
    
    /**
     * Update scroll sync button
     */
    function updateScrollSyncButton(enabled) {
        scrollSyncEnabled = enabled;
        toggleAutoScrollBtn.textContent = enabled ? 'Auto-Scroll: ON' : 'Auto-Scroll: OFF';
    }
    
    /**
     * Navigate to the next operation
     */
    function navigateToNextOperation() {
        if (operations.length === 0) return;
        
        let index = -1;
        if (highlightedOperationId) {
            index = operations.findIndex(op => op.id === highlightedOperationId);
        }
        
        if (index < operations.length - 1) {
            highlightOperation(operations[index + 1].id);
        }
    }
    
    /**
     * Navigate to the previous operation
     */
    function navigateToPreviousOperation() {
        if (operations.length === 0) return;
        
        let index = operations.length;
        if (highlightedOperationId) {
            index = operations.findIndex(op => op.id === highlightedOperationId);
        }
        
        if (index > 0) {
            highlightOperation(operations[index - 1].id);
        }
    }
})(); 