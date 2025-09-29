
// Test token script - this will set a test token in localStorage
// Run this in the browser console on the frontend to enable API testing

if (typeof localStorage !== 'undefined') {
  localStorage.setItem('token', 'test-token-123');
  console.log('✅ Test token set: test-token-123');
  console.log('🔄 Please refresh the page to use the new token');
} else {
  console.log('❌ localStorage not available');
}
