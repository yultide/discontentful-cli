import figlet from 'figlet';

export const renderTitle = () => {
	const text = figlet.textSync('Contentful Tools', {
		font: 'Small',
	});
	console.log(`\n${text}\n`);
};
